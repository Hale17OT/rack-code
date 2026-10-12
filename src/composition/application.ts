import { homedir } from "node:os";
import { join } from "node:path";

import { InMemoryCredentialResolver } from "../adapters/authentication/in-memory-credential-resolver.js";
import { DirectoryRuntimeContextResolver } from "../adapters/authentication/directory-runtime-context-resolver.js";
import { ClaudeRuntimeAdapter } from "../adapters/runtimes/claude.js";
import { CodexRuntimeAdapter } from "../adapters/runtimes/codex.js";
import { JsonAccountStore } from "../adapters/storage/json-account-store.js";
import { JsonExecutionStore } from "../adapters/storage/json-execution-store.js";
import { JsonProjectStore } from "../adapters/storage/json-project-store.js";
import { JsonSessionStore } from "../adapters/storage/json-session-store.js";
import type {
  CredentialResolver,
  RuntimeContextResolver,
} from "../core/authentication/contracts.js";
import { AccountsService } from "../core/accounts/service.js";
import { ExecutionService } from "../core/execution/service.js";
import { RuntimeRegistry } from "../core/execution/runtime-registry.js";
import { ProjectsService } from "../core/projects/service.js";
import { SessionsService } from "../core/sessions/service.js";

export interface Application {
  readonly accounts: AccountsService;
  readonly projects: ProjectsService;
  readonly sessions: SessionsService;
  readonly execution: ExecutionService;
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
  const credentials = options.credentials ?? new InMemoryCredentialResolver();
  const runtimeContexts = options.runtimeContexts ?? new DirectoryRuntimeContextResolver(
    join(dataDirectory, "runtime-contexts"),
  );

  const accounts = new AccountsService(new JsonAccountStore(join(dataDirectory, "accounts.json")));
  const projects = new ProjectsService(new JsonProjectStore(join(dataDirectory, "projects.json")));
  const sessions = new SessionsService(new JsonSessionStore(join(dataDirectory, "sessions.json")));
  const executionStore = new JsonExecutionStore(join(dataDirectory, "execution.json"));
  const runtimes = new RuntimeRegistry();
  runtimes.register(new CodexRuntimeAdapter(credentials, runtimeContexts));
  runtimes.register(new ClaudeRuntimeAdapter(credentials, runtimeContexts));
  const execution = new ExecutionService(
    executionStore,
    accounts,
    sessions,
    projects,
    runtimes,
  );

  return {
    accounts,
    projects,
    sessions,
    execution,
    runtimes,
    credentials,
    runtimeContexts,
    dataDirectory,
  };
}
