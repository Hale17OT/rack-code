/**
 * Host-side owner of in-flight `ExecutionHandle`s.
 *
 * The UI specification requires that a handle's `events` iterable is consumed
 * exactly once, that a renderer disconnect is not a cancellation, and that
 * pending approvals survive until some client answers them. Clients therefore
 * never hold handles; this class does. It:
 *
 * - drains each handle's events in the background and broadcasts them as
 *   indexed `run.event`s;
 * - keeps an in-memory copy of every event and every unanswered approval so
 *   a client that (re)connects mid-run can render an exact snapshot;
 * - forwards approval decisions and cancellation to the handle;
 * - emits `run.finished` with the persisted record once `completed` settles,
 *   then forgets the run. Durable history lives in the execution journal.
 *
 * Nothing here changes run state directly; ExecutionService remains the only
 * writer of run, attempt, and journal records.
 */
import type { ExecutionHandle } from "../../core/execution/service.js";
import type { ApprovalRequest, RuntimeEvent } from "../../core/execution/types.js";
import type { HostEvent } from "../../contracts/desktop/events.js";
import type { ActiveRunView, RunView } from "../../contracts/desktop/views.js";
import { HostOperationError } from "./errors.js";

interface ActiveRun {
  readonly handle: ExecutionHandle;
  readonly projectId: string;
  readonly sessionId: string;
  run: RunView;
  readonly events: RuntimeEvent[];
  readonly pendingApprovals: Map<string, ApprovalRequest>;
  cancelRequested: boolean;
  readonly fallbackFromAccountId?: string;
  /** Settles after `run.finished` has been emitted. */
  done: Promise<void>;
}

export interface ActiveRunsDependencies {
  /** Broadcasts an event to every connected client. */
  readonly emit: (event: HostEvent) => void;
  /** Loads the persisted run with attempts; used after status transitions. */
  readonly loadRun: (runId: string) => Promise<RunView>;
}

export class ActiveRuns {
  private readonly runs = new Map<string, ActiveRun>();

  constructor(private readonly dependencies: ActiveRunsDependencies) {}

  /**
   * Takes ownership of a freshly started handle and begins draining it. The
   * returned promise is not awaited by callers: the run outlives the request
   * that started it.
   */
  track(handle: ExecutionHandle, run: RunView, fallbackFromAccountId?: string): void {
    const active: ActiveRun = {
      handle,
      projectId: run.projectId,
      sessionId: run.sessionId,
      run,
      events: [],
      pendingApprovals: new Map(),
      cancelRequested: false,
      ...(fallbackFromAccountId === undefined ? {} : { fallbackFromAccountId }),
      done: Promise.resolve(),
    };
    // Register before draining so a fast run cannot finish (and delete
    // itself) before it was ever added.
    this.runs.set(run.id, active);
    active.done = this.drain(active);
  }

  /** Snapshots for every active run, used by `runs.active`. */
  list(): readonly ActiveRunView[] {
    return [...this.runs.values()].map((active) => ({
      run: active.run,
      events: [...active.events],
      pendingApprovals: [...active.pendingApprovals.values()],
      cancelRequested: active.cancelRequested,
      ...(active.fallbackFromAccountId === undefined
        ? {}
        : { fallbackFromAccountId: active.fallbackFromAccountId }),
    }));
  }

  /** Number of active attempts per account, for the account view. */
  countByAccount(): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const active of this.runs.values()) {
      counts.set(active.run.accountId, (counts.get(active.run.accountId) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Answers one pending approval. An unknown or already answered ID raises
   * `ApprovalNotFoundError` from the broker and leaves other approvals alone.
   */
  respondToApproval(runId: string, approvalId: string, decision: "allow" | "deny"): void {
    const active = this.require(runId);
    active.handle.respondToApproval(approvalId, decision);
    const approval = active.pendingApprovals.get(approvalId);
    active.pendingApprovals.delete(approvalId);
    if (approval !== undefined) {
      this.dependencies.emit({ type: "run.approval_resolved", runId, approval, decision });
    }
  }

  /**
   * Requests cancellation. Repeated calls are no-ops so the UI can treat
   * cancel as idempotent; the run stays active until the runtime reports a
   * terminal state.
   */
  async cancel(runId: string): Promise<void> {
    const active = this.require(runId);
    if (active.cancelRequested) {
      return;
    }
    active.cancelRequested = true;
    this.dependencies.emit({ type: "run.cancel_requested", runId });
    await active.handle.cancel();
  }

  /**
   * Stop-on-exit support: cancels every active run and waits until each has
   * persisted a terminal state or `timeoutMs` elapses, whichever comes first.
   * Returns the number of runs still active when the wait ended.
   */
  async cancelAll(timeoutMs: number): Promise<number> {
    const pending = [...this.runs.keys()];
    await Promise.allSettled(pending.map((runId) => this.cancel(runId)));
    const allDone = Promise.allSettled([...this.runs.values()].map((active) => active.done));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([allDone, timeout]);
    clearTimeout(timer);
    return this.runs.size;
  }

  private require(runId: string): ActiveRun {
    const active = this.runs.get(runId);
    if (active === undefined) {
      throw new HostOperationError("run_not_active", `Run '${runId}' is not active in this host.`, { runId });
    }
    return active;
  }

  private async drain(active: ActiveRun): Promise<void> {
    const { emit, loadRun } = this.dependencies;
    const runId = active.run.id;
    try {
      for await (const event of active.handle.events) {
        const index = active.events.length;
        active.events.push(event);
        if (event.type === "approval_request") {
          active.pendingApprovals.set(event.request.id, event.request);
        }
        emit({ type: "run.event", runId, index, event });
        if (index === 0) {
          // By the first event the service has taken the workspace writer
          // lock and marked the run running; refresh both for clients.
          await this.refresh(active);
          emit({ type: "workspaces.changed", projectId: active.projectId });
          emit({ type: "sessions.changed", projectId: active.projectId, sessionId: active.sessionId });
        }
        if (event.type === "availability") {
          emit({ type: "accounts.changed" });
        }
      }
    } catch {
      // The execution service records failures itself and always settles
      // `completed`; an iterator error here must not prevent that wait.
    }

    let finished: RunView;
    try {
      await active.handle.completed;
      finished = await loadRun(runId);
    } catch {
      // Fall back to the last known snapshot so clients still see the run
      // leave the active set; a later `runs.list` shows the stored record.
      finished = active.run;
    }
    this.runs.delete(runId);
    emit({ type: "run.finished", run: finished });
    emit({ type: "accounts.changed" });
    emit({ type: "workspaces.changed", projectId: active.projectId });
    emit({ type: "sessions.changed", projectId: active.projectId, sessionId: active.sessionId });
  }

  private async refresh(active: ActiveRun): Promise<void> {
    try {
      active.run = await this.dependencies.loadRun(active.run.id);
      this.dependencies.emit({ type: "run.updated", run: active.run });
    } catch {
      // A transient read failure only delays the status label; the final
      // `run.finished` always carries the persisted record.
    }
  }
}
