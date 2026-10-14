/**
 * Typed command surface exposed by the execution host to desktop clients.
 *
 * `HostCommandMap` is the single source of truth: each entry names the
 * parameters a client sends and the result it receives. `COMMAND_VALIDATORS`
 * holds the matching runtime validators. Adding a command means adding one
 * entry to each, then a handler in the host; the compiler flags any missing
 * piece because the host handler table is typed against this map.
 *
 * Commands are direct request/response calls. Facts that happen later, such
 * as streamed runtime output, arrive separately as `HostEvent`s.
 */
import {
  empty,
  boolean,
  object,
  oneOf,
  optional,
  text,
  type Validator,
} from "./validation.js";
import type { ProjectChanges, ProjectRepositories, RepositoryDiscoveryOptions } from "./views.js";
import {
  PERMISSION_MODES,
  type AccountView,
  type ActiveRunView,
  type ConnectProviderView,
  type ConnectView,
  type JournalEntryView,
  type PermissionMode,
  type RunView,
  type RuntimeCapabilities,
  type RuntimeView,
  type ModelCatalogView,
  type SessionSummaryView,
  type SessionView,
  type StartRunResult,
  type ProjectView,
  type SessionDiscovery,
  type ExternalSessionSnapshot,
  type ImportSessionResult,
} from "./views.js";

/** Opaque credential reference; the host obtains it, never the secret. */
export interface CredentialReferenceParams {
  readonly id: string;
  readonly providerId: string;
  readonly method: string;
}

export interface RegisterAccountParams {
  readonly providerId: string;
  readonly providerAccountId: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly credential: CredentialReferenceParams;
  readonly runtimeContextId: string;
}

export interface StartRunParams {
  readonly sessionId: string;
  readonly projectId: string;
  readonly providerId: string;
  readonly runtimeId: string;
  /** Omit to let the Accounts service choose the selected or fallback account. */
  readonly accountId?: string;
  readonly prompt: string;
  readonly model?: string;
  /** A level from the selected model's `reasoningEfforts`; omit for the provider default. */
  readonly reasoningEffort?: string;
  readonly permissionMode: PermissionMode;
}

type NoParams = Record<string, never>;

export interface HostCommandMap {
  "accounts.list": { params: NoParams; result: readonly AccountView[] };
  "accounts.register": { params: RegisterAccountParams; result: AccountView };
  "accounts.select": { params: { readonly providerId: string; readonly accountId: string }; result: AccountView };
  "accounts.reauthenticate": {
    params: {
      readonly accountId: string;
      readonly credential: CredentialReferenceParams;
      readonly runtimeContextId?: string;
    };
    result: AccountView;
  };
  /** Providers with an interactive sign-in. */
  "auth.providers": { params: NoParams; result: readonly ConnectProviderView[] };
  /** Starts a sign-in; pass `accountId` to reconnect an existing account. */
  "auth.connect": { params: { readonly providerId: string; readonly accountId?: string }; result: ConnectView };
  "auth.submitCode": { params: { readonly connectId: string; readonly code: string }; result: null };
  "auth.cancel": { params: { readonly connectId: string }; result: null };
  /** Sign-ins in progress, for clients that open mid-flow. */
  "auth.active": { params: NoParams; result: readonly ConnectView[] };
  "projects.list": { params: NoParams; result: readonly ProjectView[] };
  "projects.changes": { params: { readonly projectId: string; readonly repositoryPath?: string }; result: ProjectChanges };
  "projects.repositories": { params: { readonly projectId: string } & RepositoryDiscoveryOptions; result: ProjectRepositories };
  "projects.create": {
    params: {
      readonly path: string;
      readonly startingRevision?: string;
    };
    result: ProjectView;
  };
  /** Omit `projectId` to list sessions from every project. */
  "sessions.list": { params: { readonly projectId?: string }; result: readonly SessionSummaryView[] };
  "sessions.create": {
    params: { readonly projectId: string; readonly title?: string };
    result: SessionView;
  };
  "sessions.get": { params: { readonly sessionId: string }; result: SessionView };
  "sessions.discover": { params: { readonly projectId: string }; result: SessionDiscovery };
  "sessions.previewImport": {
    params: { readonly projectId: string; readonly sourceId: string; readonly nativeSessionId: string };
    result: ExternalSessionSnapshot;
  };
  "sessions.import": {
    params: { readonly projectId: string; readonly sourceId: string; readonly nativeSessionId: string };
    result: ImportSessionResult;
  };
  "runtimes.list": { params: NoParams; result: readonly RuntimeView[] };
  "models.list": { params: { readonly projectId?: string }; result: ModelCatalogView };
  "runtimes.capabilities": {
    params: { readonly runtimeId: string; readonly accountId: string };
    result: RuntimeCapabilities;
  };
  "runs.start": { params: StartRunParams; result: StartRunResult };
  "runs.list": { params: { readonly sessionId: string }; result: readonly RunView[] };
  "runs.journal": { params: { readonly runId: string }; result: readonly JournalEntryView[] };
  "runs.active": { params: NoParams; result: readonly ActiveRunView[] };
  "runs.respondToApproval": {
    params: { readonly runId: string; readonly approvalId: string; readonly decision: "allow" | "deny" };
    result: null;
  };
  "runs.cancel": { params: { readonly runId: string }; result: null };
}

export type HostCommand = keyof HostCommandMap;
export type CommandParams<C extends HostCommand> = HostCommandMap[C]["params"];
export type CommandResult<C extends HostCommand> = HostCommandMap[C]["result"];

const id = text({ maxLength: 256 });
const credential = object({ id, providerId: id, method: id });

/** Runtime validators, one per command, typed against `HostCommandMap`. */
export const COMMAND_VALIDATORS: { readonly [C in HostCommand]: Validator<CommandParams<C>> } = {
  "accounts.list": empty,
  "accounts.register": object({
    providerId: id,
    providerAccountId: id,
    email: optional(text({ maxLength: 320 })),
    displayName: optional(text({ maxLength: 256 })),
    credential,
    runtimeContextId: id,
  }),
  "accounts.select": object({ providerId: id, accountId: id }),
  "accounts.reauthenticate": object({ accountId: id, credential, runtimeContextId: optional(id) }),
  "auth.providers": empty,
  "auth.connect": object({ providerId: id, accountId: optional(id) }),
  "auth.submitCode": object({ connectId: id, code: text({ maxLength: 4096 }) }),
  "auth.cancel": object({ connectId: id }),
  "auth.active": empty,
  "projects.list": empty,
  "projects.changes": object({ projectId: id, repositoryPath: optional(text()) }),
  "projects.repositories": object({ projectId: id, rescan: optional(boolean), deep: optional(boolean), repositoryPath: optional(text()) }),
  "projects.create": object({
    path: text(),
    startingRevision: optional(id),
  }),
  "sessions.list": object({ projectId: optional(id) }),
  "sessions.create": object({ projectId: id, title: optional(text({ maxLength: 256 })) }),
  "sessions.get": object({ sessionId: id }),
  "sessions.discover": object({ projectId: id }),
  "sessions.previewImport": object({ projectId: id, sourceId: id, nativeSessionId: id }),
  "sessions.import": object({ projectId: id, sourceId: id, nativeSessionId: id }),
  "runtimes.list": empty,
  "models.list": object({ projectId: optional(id) }),
  "runtimes.capabilities": object({ runtimeId: id, accountId: id }),
  "runs.start": object({
    sessionId: id,
    projectId: id,
    providerId: id,
    runtimeId: id,
    accountId: optional(id),
    prompt: text({ maxLength: 200_000 }),
    model: optional(id),
    // Provider-defined level names (Codex reports free-form strings), so the
    // contract bounds the shape; the adapter checks support for the model.
    reasoningEffort: optional(text({ maxLength: 32 })),
    permissionMode: oneOf(PERMISSION_MODES),
  }),
  "runs.list": object({ sessionId: id }),
  "runs.journal": object({ runId: id }),
  "runs.active": empty,
  "runs.respondToApproval": object({ runId: id, approvalId: id, decision: oneOf(["allow", "deny"]) }),
  "runs.cancel": object({ runId: id }),
};

/** Narrows an untrusted method name to a known command. */
export function isHostCommand(value: unknown): value is HostCommand {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COMMAND_VALIDATORS, value);
}

/** Validates untrusted parameters for a known command. */
export function validateCommandParams<C extends HostCommand>(command: C, params: unknown): CommandParams<C> {
  // Clients may send `undefined` for parameterless commands.
  const validator = COMMAND_VALIDATORS[command] as Validator<CommandParams<C>>;
  return validator(params ?? {}, "");
}
