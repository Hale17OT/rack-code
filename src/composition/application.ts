import { homedir } from "node:os";
import { join } from "node:path";

import { InMemoryCredentialResolver } from "../adapters/authentication/in-memory-credential-resolver.js";
import { DirectoryRuntimeContextResolver } from "../adapters/authentication/directory-runtime-context-resolver.js";
import { ClaudeConnector } from "../adapters/authentication/claude-connector.js";
import { CodexConnector } from "../adapters/authentication/codex-connector.js";
import { NativeLoginCredentialResolver } from "../adapters/authentication/native-login-credential-resolver.js";
import { ClaudeRuntimeAdapter } from "../adapters/runtimes/claude.js";
import { CodexRuntimeAdapter } from "../adapters/runtimes/codex.js";
import { JsonAccountStore } from "../adapters/storage/json-account-store.js";
import { JsonExecutionStore } from "../adapters/storage/json-execution-store.js";
import { JsonWorkspaceStore } from "../adapters/storage/json-workspace-store.js";
import { JsonSessionStore } from "../adapters/storage/json-session-store.js";
import type {
  CredentialResolver,
  RuntimeContextResolver,
} from "../core/authentication/contracts.js";
import { AccountsService } from "../core/accounts/service.js";
import type { AccountConnector } from "../core/connections/ports.js";
import { ConnectionsService } from "../core/connections/service.js";
import { ExecutionService } from "../core/execution/service.js";
import { RuntimeRegistry } from "../core/execution/runtime-registry.js";
import { WorkspacesService } from "../core/workspaces/service.js";
import { SessionsService } from "../core/sessions/service.js";

export interface Application {
  readonly accounts: AccountsService;
  readonly workspaces: WorkspacesService;
  readonly sessions: SessionsService;
  readonly execution: ExecutionService;
  readonly connections: ConnectionsService;
  readonly runtimes: RuntimeRegistry;
  readonly credentials: CredentialResolver;
  readonly runtimeContexts: RuntimeContextResolver;
  readonly dataDirectory: string;
}

export interface CreateApplicationOptions {
  /** Root for local MVP metadata and isolated provider configuration. */
  readonly dataDirectory?: string;
  /** Protected credential implementation supplied by the host. */
  readonly credentials?: CredentialResolver;
  /** Runtime-context implementation supplied by the host or tests. */
  readonly runtimeContexts?: RuntimeContextResolver;
  /** Provider sign-in connectors; defaults to Codex and Claude. */
  readonly connectors?: readonly AccountConnector[];
}

/**
 * Explicit startup composition for the headless MVP.
 *
 * No module performs import-time registration. This function is the only
 * place that chooses JSON persistence and the two first-class runtimes; a
 * future adapter can be added by registering it here without changing core.
 */
export function createApplication(options: CreateApplicationOptions = {}): Application {
  const dataDirectory = options.dataDirectory ?? join(homedir(), ".thinking-and-code");
  // Accounts connected through a provider sign-in use the provider's own
  // login in their runtime context; other references fall back to the
  // supplied (or in-memory) resolver.
  const credentials = new NativeLoginCredentialResolver(options.credentials ?? new InMemoryCredentialResolver());
  const runtimeContexts = options.runtimeContexts ?? new DirectoryRuntimeContextResolver(
    join(dataDirectory, "runtime-contexts"),
  );

  const accounts = new AccountsService(new JsonAccountStore(join(dataDirectory, "accounts.json")));
  const workspaces = new WorkspacesService(new JsonWorkspaceStore(join(dataDirectory, "workspaces.json"), join(dataDirectory, "projects.json")));
  const sessions = new SessionsService(new JsonSessionStore(join(dataDirectory, "sessions.json")));
  const executionStore = new JsonExecutionStore(join(dataDirectory, "execution.json"));
  const runtimes = new RuntimeRegistry();
  runtimes.register(new CodexRuntimeAdapter(credentials, runtimeContexts));
  runtimes.register(new ClaudeRuntimeAdapter(credentials, runtimeContexts));
  const execution = new ExecutionService(
    executionStore,
    accounts,
    sessions,
    workspaces,
    runtimes,
  );

  const connections = new ConnectionsService(
    accounts,
    runtimeContexts,
    options.connectors ?? [new CodexConnector(), new ClaudeConnector()],
  );

  return {
    accounts,
    connections,
    workspaces,
    sessions,
    execution,
    runtimes,
    credentials,
    runtimeContexts,
    dataDirectory,
  };
}
