/**
 * Transport-independent command dispatcher for the execution host.
 *
 * `HostApi.dispatch` validates untrusted parameters against the desktop
 * contract, calls the owning application service, and maps results to
 * serializable views. It knows nothing about Electron, so it is exercised
 * directly by headless tests and could be reused by a future remote host.
 *
 * Responsibilities kept here (and not in the renderer):
 * - stripping credential references and runtime-context IDs from accounts;
 * - refusing to start a run on a shared project that already has a writer,
 *   so the UI gets `project_busy` with the owning attempt instead of a
 *   failed run (the core lock remains the authoritative guard);
 * - reporting whether the Accounts service fell back from the selected
 *   account when the caller did not name one.
 */
import type { AccountRecord } from "../../core/accounts/types.js";
import type { AccountsService } from "../../core/accounts/service.js";
import type { ExecutionService } from "../../core/execution/service.js";
import type { RuntimeRegistry } from "../../core/execution/runtime-registry.js";
import type { RunRecord } from "../../core/execution/types.js";
import type { ProjectsService } from "../../core/projects/service.js";
import type { ConnectionsService } from "../../core/connections/service.js";
import type { SessionsService } from "../../core/sessions/service.js";
import type { SessionImportsService } from "../../core/session-imports/service.js";
import {
  isHostCommand,
  validateCommandParams,
  type CommandParams,
  type CommandResult,
  type HostCommand,
} from "../../contracts/desktop/commands.js";
import type { HostEvent } from "../../contracts/desktop/events.js";
import type { CommandResponse } from "../../contracts/desktop/transport.js";
import {
  PERMISSION_MODES,
  type AccountView,
  type PermissionMode,
  type RunView,
  type SessionSummaryView,
} from "../../contracts/desktop/views.js";
import { ActiveRuns } from "./active-runs.js";
import { HostOperationError, toHostError } from "./errors.js";

/** The application services the host needs; satisfied by `createApplication`. */
export interface HostApplication {
  readonly accounts: AccountsService;
  readonly projects: ProjectsService;
  readonly sessions: SessionsService;
  readonly sessionImports: SessionImportsService;
  readonly execution: ExecutionService;
  readonly connections: ConnectionsService;
  readonly runtimes: RuntimeRegistry;
}

type Handlers = {
  readonly [C in HostCommand]: (params: CommandParams<C>) => Promise<CommandResult<C>>;
};

export class HostApi {
  private readonly activeRuns: ActiveRuns;
  private readonly handlers: Handlers;

  constructor(
    private readonly app: HostApplication,
    private readonly emit: (event: HostEvent) => void,
  ) {
    this.activeRuns = new ActiveRuns({ emit, loadRun: (runId) => this.loadRun(runId) });
    this.handlers = this.createHandlers();
    // Sign-in progress is pushed to every client; a completed sign-in also
    // changed account records.
    app.connections.subscribe((connect) => {
      emit({ type: "auth.updated", connect });
      if (connect.status === "completed") emit({ type: "accounts.changed" });
    });
  }

  /**
   * Executes one command from an untrusted client. Never throws: failures
   * are returned as `{ ok: false, error }` with a stable code.
   */
  async dispatch(command: unknown, params: unknown): Promise<CommandResponse> {
    try {
      if (!isHostCommand(command)) {
        throw new HostOperationError("unknown_command", `Unknown command '${String(command)}'.`);
      }
      const validated = validateCommandParams(command, params);
      const handler = this.handlers[command] as (input: typeof validated) => Promise<unknown>;
      return { ok: true, value: await handler(validated) };
    } catch (error) {
      return { ok: false, error: toHostError(error) };
    }
  }

  /** Stop-on-exit: cancels sign-ins, then runs (see `ActiveRuns.cancelAll`). */
  async shutdown(timeoutMs: number): Promise<number> {
    await this.app.connections.cancelAll();
    return this.activeRuns.cancelAll(timeoutMs);
  }

  private createHandlers(): Handlers {
    const { accounts, projects, sessions, sessionImports, execution, runtimes, connections } = this.app;
    return {
      "projects.changes": async (params) => projects.getChanges(params.projectId, params.repositoryPath),
      "projects.repositories": async ({ projectId, ...options }) => projects.discoverRepositories(projectId, options),
      "auth.providers": async () => connections.providers(),
      "auth.connect": async (params) => connections.connect(params),
      "auth.submitCode": async (params) => {
        connections.submitCode(params.connectId, params.code);
        return null;
      },
      "auth.cancel": async (params) => {
        await connections.cancel(params.connectId);
        return null;
      },
      "auth.active": async () => connections.active(),
      "accounts.list": async () => this.listAccounts(),
      "accounts.register": async (params) => {
        const account = await accounts.register({
          providerId: params.providerId,
          identity: {
            providerAccountId: params.providerAccountId,
            ...(params.email === undefined ? {} : { email: params.email }),
            ...(params.displayName === undefined ? {} : { displayName: params.displayName }),
          },
          credential: params.credential,
          runtimeContextId: params.runtimeContextId,
        });
        this.emit({ type: "accounts.changed" });
        return this.accountView(account);
      },
      "accounts.select": async (params) => {
        const account = await accounts.select(params.providerId, params.accountId);
        this.emit({ type: "accounts.changed" });
        return this.accountView(account);
      },
      "accounts.reauthenticate": async (params) => {
        const account = await accounts.reauthenticate(params.accountId, {
          credential: params.credential,
          ...(params.runtimeContextId === undefined ? {} : { runtimeContextId: params.runtimeContextId }),
        });
        this.emit({ type: "accounts.changed" });
        return this.accountView(account);
      },

      "projects.list": async () => projects.listProjects(),
      "projects.create": async (params) => {
        const project = await projects.createProject(params);
        this.emit({ type: "projects.changed" });
        return project;
      },

      "sessions.list": async (params) => {
        const projectId = params.projectId === undefined ? undefined : (await projects.getProject(params.projectId)).id;
        return (await sessions.list(projectId)).map(
        (session): SessionSummaryView => ({
          id: session.id,
          projectId: session.projectId,
          ...(session.title === undefined ? {} : { title: session.title }),
          messageCount: session.messages.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        }),
        );
      },
      "sessions.create": async (params) => {
        // Validate the project before persisting the session.
        const project = await projects.getProject(params.projectId);
        const session = await sessions.create({ ...params, projectId: project.id });
        this.emit({ type: "sessions.changed", projectId: session.projectId, sessionId: session.id });
        return session;
      },
      "sessions.get": async (params) => sessions.get(params.sessionId),
      "sessions.attachFiles": async (params) => sessions.attachFiles(params.sessionId, params.paths),
      "sessions.discover": async (params) => sessionImports.discover(params.projectId),
      "sessions.previewImport": async (params) => {
        const snapshot = await sessionImports.preview(params.projectId, params.sourceId, params.nativeSessionId);
        // Preview the latest visible conversation with bounded transport data.
        // Import itself re-reads and saves the complete snapshot.
        return { ...snapshot, messages: snapshot.messages.filter((message) => message.role === "user" || message.role === "assistant").slice(-12).map((message) => ({
          ...message, content: message.content.slice(0, 4000),
        })) };
      },
      "sessions.import": async (params) => {
        const result = await sessionImports.import(params.projectId, params.sourceId, params.nativeSessionId);
        this.emit({ type: "sessions.changed", projectId: result.session.projectId, sessionId: result.session.id });
        return result;
      },

      "runtimes.list": async () => runtimes.list().map((runtimeId) => {
        const runtime = runtimes.get(runtimeId);
        const permissionMappings = Object.fromEntries(
          PERMISSION_MODES.map((mode) => [mode, runtime.describePermissionMode(mode)]),
        ) as Record<PermissionMode, string>;
        return { runtimeId, ...(runtime.providerId === undefined ? {} : { providerId: runtime.providerId }), permissionMappings };
      }),
      "models.list": async (params) => {
        // Discovery runs in the selected project when one is available so
        // providers see the same working directory that a subsequent run
        // will use. The catalog remains account-scoped and never receives
        // renderer credentials or provider SDK objects.
        const projectPath = params.projectId === undefined
          ? undefined
          : (await projects.getProject(params.projectId)).path;
        const providerNames = new Map(connections.providers().map((provider) => [provider.providerId, provider.displayName]));
        const accountsByProvider = new Map<string, AccountRecord[]>();
        for (const account of await accounts.list()) {
          const list = accountsByProvider.get(account.providerId) ?? [];
          list.push(account);
          accountsByProvider.set(account.providerId, list);
        }
        const models = new Map<string, { readonly model: import("../../core/execution/types.js").RuntimeModel; readonly runtimeId: string; readonly accountIds: string[] }>();
        const failures: { readonly providerName: string; readonly accountId: string }[] = [];
        for (const runtimeId of runtimes.list()) {
          const runtime = runtimes.get(runtimeId);
          if (runtime.models === undefined || runtime.providerId === undefined) continue;
          for (const account of accountsByProvider.get(runtime.providerId) ?? []) {
            try {
              const entries = await runtime.models({
                account: { accountId: account.id, providerId: account.providerId, credential: account.credential, runtimeContextId: account.runtimeContextId },
                ...(projectPath === undefined ? {} : { projectPath }),
              });
              for (const model of entries) {
                const key = `${runtimeId}|${model.providerId}|${model.id}`;
                const current = models.get(key);
                if (current === undefined) models.set(key, { model, runtimeId, accountIds: [account.id] });
                else if (!current.accountIds.includes(account.id)) current.accountIds.push(account.id);
              }
            } catch {
              failures.push({ providerName: providerNames.get(account.providerId) ?? account.providerId, accountId: account.id });
            }
          }
        }
        return {
          models: [...models.values()].map(({ model, runtimeId, accountIds }) => ({
            ...model, runtimeId, accountIds: [...accountIds], providerName: providerNames.get(model.providerId) ?? model.providerId,
          })),
          failures,
        };
      },
      "runtimes.capabilities": async (params) => {
        const account = await accounts.get(params.accountId);
        return runtimes.get(params.runtimeId).capabilities({
          accountId: account.id,
          providerId: account.providerId,
          credential: account.credential,
          runtimeContextId: account.runtimeContextId,
        });
      },

      "runs.start": async (params) => {
        const project = await projects.getProject(params.projectId);
        if (project.activeWriterAttemptId !== undefined) {
          throw new HostOperationError(
            "project_busy",
            `Project '${project.id}' is already being edited by attempt '${project.activeWriterAttemptId}'.`,
            { projectId: project.id, attemptId: project.activeWriterAttemptId },
          );
        }
        // Read the selection before starting so a fallback can be reported.
        const selected = params.accountId === undefined
          ? await accounts.selected(params.providerId)
          : undefined;
        const handle = await execution.start(params);
        const run = await this.loadRun(handle.runId);
        const fallbackFromAccountId = selected !== undefined && selected.id !== run.accountId
          ? selected.id
          : undefined;
        this.activeRuns.track(handle, run, fallbackFromAccountId);
        const started = {
          run,
          ...(fallbackFromAccountId === undefined ? {} : { fallbackFromAccountId }),
        };
        this.emit({ type: "run.started", ...started });
        this.emit({ type: "accounts.changed" });
        return started;
      },
      "runs.list": async (params) => {
        const runs = await execution.listRuns(params.sessionId);
        return Promise.all(runs.map((run) => this.runView(run)));
      },
      "runs.journal": async (params) => execution.listJournal(params.runId),
      "runs.active": async () => this.activeRuns.list(),
      "runs.respondToApproval": async (params) => {
        this.activeRuns.respondToApproval(params.runId, params.approvalId, params.decision);
        return null;
      },
      "runs.cancel": async (params) => {
        await this.activeRuns.cancel(params.runId);
        return null;
      },
    };
  }

  private async listAccounts(): Promise<readonly AccountView[]> {
    const all = await this.app.accounts.list();
    const counts = this.activeRuns.countByAccount();
    const selectedByProvider = new Map<string, string | undefined>();
    for (const providerId of new Set(all.map((account) => account.providerId))) {
      selectedByProvider.set(providerId, (await this.app.accounts.selected(providerId))?.id);
    }
    return all.map((account) => toAccountView(
      account,
      selectedByProvider.get(account.providerId) === account.id,
      counts.get(account.id) ?? 0,
    ));
  }

  private async accountView(account: AccountRecord): Promise<AccountView> {
    const selected = await this.app.accounts.selected(account.providerId);
    return toAccountView(account, selected?.id === account.id, this.activeRuns.countByAccount().get(account.id) ?? 0);
  }

  private async loadRun(runId: string): Promise<RunView> {
    return this.runView(await this.app.execution.getRun(runId));
  }

  private async runView(run: RunRecord): Promise<RunView> {
    const attempts = await Promise.all(run.attemptIds.map((id) => this.app.execution.getAttempt(id)));
    return { ...run, attempts };
  }
}

/** Copies only display-safe fields; credential and runtime context stay in the host. */
function toAccountView(account: AccountRecord, selected: boolean, activeAttempts: number): AccountView {
  return {
    id: account.id,
    providerId: account.providerId,
    identity: { ...account.identity },
    availability: account.availability,
    ...(account.availabilityReason === undefined ? {} : { availabilityReason: account.availabilityReason }),
    ...(account.quotaResetAt === undefined ? {} : { quotaResetAt: account.quotaResetAt }),
    ...(account.lastUsedAt === undefined ? {} : { lastUsedAt: account.lastUsedAt }),
    createdAt: account.createdAt,
    selected,
    activeAttempts,
  };
}
