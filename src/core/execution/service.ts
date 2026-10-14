import { randomUUID } from "node:crypto";

import type { AccountsService } from "../accounts/service.js";
import type { AccountRecord } from "../accounts/types.js";
import type { WorkspacesService } from "../workspaces/service.js";
import type { SessionsService } from "../sessions/service.js";
import { AccountProviderMismatchError } from "../accounts/errors.js";
import {
  ApprovalNotFoundError,
  AttemptNotFoundError,
  NoEligibleAccountError,
  RunNotFoundError,
} from "./errors.js";
import type { ExecutionStore } from "./ports.js";
import { AsyncQueue } from "../shared/async-queue.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
  AttemptRecord,
  JournalEntry,
  PermissionMode,
  RunRecord,
  RuntimeEvent,
  RuntimeRunInput,
} from "./types.js";

export interface StartRunInput {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly providerId: string;
  readonly runtimeId: string;
  readonly accountId?: string;
  readonly prompt: string;
  readonly model?: string;
  readonly permissionMode: PermissionMode;
}

export interface ExecutionHandle {
  readonly runId: string;
  readonly attemptId: string;
  readonly events: AsyncIterable<RuntimeEvent>;
  readonly completed: Promise<RunRecord>;
  respondToApproval(approvalId: string, decision: ApprovalDecision): void;
  cancel(): Promise<void>;
}

export interface ExecutionServiceOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/**
 * Coordinates accounts, sessions, workspaces, persistence, and runtime
 * adapters for one editing attempt at a time.
 *
 * Provider implementations only emit normalized events. This service owns the
 * durable run/attempt state, approval parking, session associations, and
 * workspace writer release on every terminal path.
 */
export class ExecutionService {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly store: ExecutionStore,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspacesService,
    private readonly runtimes: RuntimeRegistry,
    options: ExecutionServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async start(input: StartRunInput): Promise<ExecutionHandle> {
    const account = await this.resolveAccount(input);
    const workspace = await this.workspaces.getWorkspace(input.workspaceId);
    const runtime = this.runtimes.get(input.runtimeId);
    const runId = this.createId();
    const attemptId = this.createId();
    const timestamp = this.now().toISOString();
    const run: RunRecord = {
      id: runId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      prompt: input.prompt,
      providerId: input.providerId,
      accountId: account.id,
      ...(input.model === undefined ? {} : { model: input.model }),
      permissionMode: input.permissionMode,
      status: "queued",
      attemptIds: [attemptId],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const attempt: AttemptRecord = {
      id: attemptId,
      runId,
      runtimeId: input.runtimeId,
      providerId: input.providerId,
      accountId: account.id,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.store.saveRun(run);
    await this.store.saveAttempt(attempt);
    await this.store.appendJournal({
      runId,
      attemptId,
      type: "run_started",
      payload: { providerId: input.providerId, accountId: account.id },
      observedAt: timestamp,
    });

    const controller = new AbortController();
    const queue = new AsyncQueue<RuntimeEvent>();
    const approvals = new ApprovalBroker(
      queue,
      this.createId,
      async (request) => {
        await this.store.appendJournal({
          runId,
          attemptId,
          type: "approval_request",
          payload: { type: "approval_request", request },
          observedAt: this.now().toISOString(),
        });
      },
    );
    let currentRun = run;
    let currentAttempt = attempt;
    let cancelled = false;
    let bufferedAssistantText = "";

    const completed = this.consume({
      input,
      account,
      runtime,
      workspacePath: workspace.path,
      run: currentRun,
      attempt: currentAttempt,
      controller,
      queue,
      approvals,
      onRun: (next) => {
        currentRun = next;
      },
      onAttempt: (next) => {
        currentAttempt = next;
      },
      getAssistantText: () => bufferedAssistantText,
      appendAssistantText: (text) => {
        bufferedAssistantText += text;
      },
      isCancelled: () => cancelled || controller.signal.aborted,
    });

    return {
      runId,
      attemptId,
      events: queue,
      completed,
      respondToApproval: (approvalId, decision) => approvals.respond(approvalId, decision),
      cancel: async () => {
        cancelled = true;
        controller.abort();
        await runtime.cancel({ attemptId, signal: controller.signal });
      },
    };
  }

  async getRun(runId: string): Promise<RunRecord> {
    const run = await this.store.getRun(runId);
    if (run === undefined) {
      throw new RunNotFoundError(runId);
    }
    return run;
  }

  /** Lists one session's runs oldest first, matching transcript order. */
  async listRuns(sessionId: string): Promise<readonly RunRecord[]> {
    const runs = await this.store.listRuns(sessionId);
    return [...runs].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getAttempt(attemptId: string): Promise<AttemptRecord> {
    const attempt = await this.store.getAttempt(attemptId);
    if (attempt === undefined) {
      throw new AttemptNotFoundError(attemptId);
    }
    return attempt;
  }

  /**
   * Returns the append-only journal for one run in sequence order. Clients
   * use it to rebuild a transcript after reconnecting instead of restarting
   * the attempt.
   */
  async listJournal(runId: string): Promise<readonly JournalEntry[]> {
    await this.getRun(runId);
    const entries = await this.store.listJournal(runId);
    return [...entries].sort((left, right) => left.sequence - right.sequence);
  }

  private async resolveAccount(input: StartRunInput): Promise<AccountRecord> {
    if (input.accountId !== undefined) {
      const account = await this.accounts.get(input.accountId);
      if (account.providerId !== input.providerId) {
        throw new AccountProviderMismatchError(account.id, input.providerId, account.providerId);
      }
      return account;
    }
    const account = await this.accounts.chooseEligible(input.providerId);
    if (account === undefined) {
      throw new NoEligibleAccountError(input.providerId);
    }
    return account;
  }

  private async consume(context: ConsumeContext): Promise<RunRecord> {
    const {
      input,
      account,
      runtime,
      workspacePath,
      run,
      attempt,
      controller,
      queue,
      approvals,
      onRun,
      onAttempt,
      getAssistantText,
      appendAssistantText,
      isCancelled,
    } = context;
    let currentRun = run;
    let currentAttempt = attempt;
    // A cleanly exhausted provider stream without a terminal event is an
    // unknown outcome: the external process may have completed an action
    // immediately before disconnecting. Provider exceptions are still marked
    // failed in the catch block below.
    let terminalStatus: RunRecord["status"] = "unknown";
    let terminalResult: string | undefined;
    let terminalError: string | undefined;

    try {
      await this.workspaces.acquireWriter(input.workspaceId, attempt.id);
      currentRun = await this.updateRun(currentRun, "running");
      currentAttempt = await this.updateAttempt(currentAttempt, "running");
      onRun(currentRun);
      onAttempt(currentAttempt);
      await this.sessions.appendMessage(input.sessionId, {
        role: "user",
        content: input.prompt,
        metadata: { runId: currentRun.id, attemptId: currentAttempt.id },
      });
      await this.accounts.markUsed(account.id);

      const runtimeInput: RuntimeRunInput = {
        runId: currentRun.id,
        attemptId: currentAttempt.id,
        sessionId: input.sessionId,
        account: {
          accountId: account.id,
          providerId: account.providerId,
          credential: account.credential,
          runtimeContextId: account.runtimeContextId,
        },
        workspacePath,
        prompt: input.prompt,
        ...(input.model === undefined ? {} : { model: input.model }),
        permissionMode: input.permissionMode,
        signal: controller.signal,
        requestApproval: async (request) => {
          if (input.permissionMode === "read_only") {
            return "deny";
          }
          return approvals.request(request);
        },
      };
      const continuation = await this.sessions.continuation(input.sessionId, runtime.runtimeId);
      const stream = continuation === undefined
        ? runtime.startRun(runtimeInput)
        : runtime.resumeRun({ ...runtimeInput, continuation });

      for await (const event of stream) {
        await this.store.appendJournal({
          runId: currentRun.id,
          attemptId: currentAttempt.id,
          type: event.type,
          payload: event,
          observedAt: this.now().toISOString(),
        });
        queue.push(event);
        if (event.type === "message_delta") {
          appendAssistantText(event.text);
        } else if (event.type === "native_session") {
          currentAttempt = await this.updateAttempt(currentAttempt, currentAttempt.status, {
            nativeSessionId: event.nativeSessionId,
          });
          onAttempt(currentAttempt);
          await this.sessions.associateContinuation(input.sessionId, {
            runtimeId: runtime.runtimeId,
            nativeSessionId: event.nativeSessionId,
          });
        } else if (event.type === "availability") {
          await this.accounts.updateAvailability(account.id, event);
        } else if (event.type === "completed") {
          terminalStatus = "completed";
          terminalResult = event.result;
        } else if (event.type === "failed") {
          terminalStatus = "failed";
          terminalError = event.error;
        } else if (event.type === "interrupted") {
          terminalStatus = "interrupted";
        }
      }

      if (isCancelled() && terminalStatus !== "completed" && terminalStatus !== "failed") {
        terminalStatus = "interrupted";
      }
      // Preserve partial assistant output even when a provider fails or is
      // interrupted; recovery must not require the exhausted runtime to
      // summarize work that was already streamed to the host.
      const assistantContent = getAssistantText().trim() === ""
        ? terminalResult
        : getAssistantText();
      if (
        assistantContent !== undefined &&
        assistantContent.trim() !== ""
      ) {
        await this.sessions.appendMessage(input.sessionId, {
          role: "assistant",
          content: assistantContent,
          metadata: { runId: currentRun.id, attemptId: currentAttempt.id },
        });
      }
    } catch (error) {
      terminalStatus = isCancelled() ? "interrupted" : "failed";
      terminalError = error instanceof Error ? error.message : String(error);
      const failure: RuntimeEvent = isCancelled()
        ? { type: "interrupted" }
        : { type: "failed", error: terminalError };
      queue.push(failure);
      await this.store.appendJournal({
        runId: currentRun.id,
        attemptId: currentAttempt.id,
        type: failure.type,
        payload: failure,
        observedAt: this.now().toISOString(),
      });
    } finally {
      approvals.close();
      try {
        await this.workspaces.releaseWriter(input.workspaceId, currentAttempt.id);
      } catch {
        // Preserve the original run outcome; a stale lock is recoverable from
        // the workspace record and is surfaced by the next start attempt.
      }
      currentAttempt = await this.updateAttempt(currentAttempt, terminalStatus);
      currentRun = await this.updateRun(currentRun, terminalStatus, {
        ...(terminalResult === undefined ? {} : { result: terminalResult }),
        ...(terminalError === undefined ? {} : { error: terminalError }),
      });
      onAttempt(currentAttempt);
      onRun(currentRun);
      await this.store.appendJournal({
        runId: currentRun.id,
        attemptId: currentAttempt.id,
        type: "run_status",
        payload: { status: terminalStatus, error: terminalError },
        observedAt: this.now().toISOString(),
      });
      queue.complete();
    }
    return currentRun;
  }

  private async updateRun(
    run: RunRecord,
    status: RunRecord["status"],
    extra: Partial<Pick<RunRecord, "result" | "error">> = {},
  ): Promise<RunRecord> {
    const updated: RunRecord = {
      ...run,
      status,
      updatedAt: this.now().toISOString(),
      ...extra,
    };
    await this.store.saveRun(updated);
    return updated;
  }

  private async updateAttempt(
    attempt: AttemptRecord,
    status: AttemptRecord["status"],
    extra: Partial<Pick<AttemptRecord, "nativeSessionId">> = {},
  ): Promise<AttemptRecord> {
    const updated: AttemptRecord = {
      ...attempt,
      status,
      updatedAt: this.now().toISOString(),
      ...extra,
    };
    await this.store.saveAttempt(updated);
    return updated;
  }
}

interface ConsumeContext {
  readonly input: StartRunInput;
  readonly account: AccountRecord;
  readonly runtime: ReturnType<RuntimeRegistry["get"]>;
  readonly workspacePath: string;
  readonly run: RunRecord;
  readonly attempt: AttemptRecord;
  readonly controller: AbortController;
  readonly queue: AsyncQueue<RuntimeEvent>;
  readonly approvals: ApprovalBroker;
  readonly onRun: (run: RunRecord) => void;
  readonly onAttempt: (attempt: AttemptRecord) => void;
  readonly getAssistantText: () => string;
  readonly appendAssistantText: (text: string) => void;
  readonly isCancelled: () => boolean;
}

class ApprovalBroker {
  private readonly pending = new Map<
    string,
    { resolve: (decision: ApprovalDecision) => void }
  >();

  constructor(
    private readonly queue: AsyncQueue<RuntimeEvent>,
    private readonly createId: () => string,
    private readonly onRequest: (request: ApprovalRequest) => Promise<void>,
  ) {}

  async request(request: Omit<ApprovalRequest, "id">): Promise<ApprovalDecision> {
    const full: ApprovalRequest = { ...request, id: this.createId() };
    const decision = new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(full.id, { resolve });
    });
    this.queue.push({ type: "approval_request", request: full });
    await this.onRequest(full);
    return decision;
  }

  respond(approvalId: string, decision: ApprovalDecision): void {
    const pending = this.pending.get(approvalId);
    if (pending === undefined) {
      throw new ApprovalNotFoundError(approvalId);
    }
    this.pending.delete(approvalId);
    pending.resolve(decision);
  }

  close(): void {
    for (const { resolve } of this.pending.values()) {
      resolve("deny");
    }
    this.pending.clear();
  }
}
