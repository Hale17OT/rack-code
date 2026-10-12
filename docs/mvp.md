# Headless MVP

Status: implemented 2026-10-12. The headless API remains the core; the Electron desktop UI built on it is described in [desktop application](desktop.md).

The composition entry point is `createApplication` from `src/index.ts`. It assembles JSON-file stores under one data directory, the Accounts, Projects, Sessions, and Execution services, an isolated runtime-context resolver, and both first-class runtime adapters:

- `codex-app-server` starts `codex app-server --stdio` and translates the app-server JSON-RPC protocol.
- `claude-agent-sdk` uses `@anthropic-ai/claude-agent-sdk` `query()` and translates SDK messages and callbacks.

The composition root accepts a `CredentialResolver`, wrapped in `NativeLoginCredentialResolver`. References created by the Connections sign-in (`native_login`) use the provider's own login in the account's runtime context. Other references go to the supplied resolver; the default `InMemoryCredentialResolver` is suitable for tests and embedding but is not a durable secret store. `ConnectionsService` (with the Codex and Claude connectors) implements "Connect <provider> account". Account JSON contains only an opaque credential reference. Each account's runtime context is hashed below `<dataDirectory>/runtime-contexts`, created with mode `0700`, and passed as `CODEX_HOME` or `CLAUDE_CONFIG_DIR`.

The headless flow is:

1. Register one or more accounts with provider identity, opaque credential reference, and runtime-context ID. Mark an account available after the host or adapter verifies it.
2. Create a project, a shared or isolated workspace, and an application session.
3. Call `execution.start` with the session, workspace, provider, runtime ID, prompt, model, and one of the four application permission modes.
4. Consume `handle.events`. Events include native session association, message deltas, tool requests/results, approval requests, usage, availability, completion, failure, and interruption.
5. Answer a pending approval with `handle.respondToApproval(id, "allow" | "deny")`, or call `handle.cancel()` to interrupt the attempt. Await `handle.completed` for the durable run outcome.

The application owns run, attempt, session, workspace-lock, and append-only journal records. Native Codex thread IDs and Claude session IDs are continuations below an application session. A new attempt selects an explicitly requested account or the Accounts service's eligible account; an unavailable selected account falls back to the most recently used available account for that provider. Active attempts keep their original account.

Permission mappings are explicit:

| App mode | Codex | Claude SDK |
| --- | --- | --- |
| `read_only` | `read-only` sandbox, no approval | `plan` |
| `ask` | `workspace-write`, `on-request` approvals | `default` with `canUseTool` |
| `approve_for_me` | `workspace-write`, `on-request` approvals | `default` with `canUseTool` |
| `full_access` | `danger-full-access`, no approval | `bypassPermissions` with `allowDangerouslySkipPermissions` |

`approve_for_me` currently uses the same interactive approval broker as `ask`; the MVP does not auto-approve actions or invent a separate reviewer policy. Adapters report browser and computer-use capabilities as false. Cross-runtime continuation uses native resume only for the same runtime; application history remains the source of truth for handoff context.

If a provider stream ends without a terminal event, Execution records an `unknown` outcome so the UI can require an explicit recovery decision rather than replaying a possibly completed side effect. Provider exceptions are `failed`, and explicit runtime cancellation is `interrupted`. Durable JSON documents are versioned with schema version `1`. Migration tooling, encrypted credential storage, automatic credential refresh, native transcript mirroring, browser integration, and background host lifetime are deferred; Electron IPC and UI presentation are covered in [desktop application](desktop.md). The tests cover account selection and re-authentication, isolated context directories, durable metadata reload, streaming execution, approvals, continuation, journal entries, workspace release, and cancellation without live provider credentials.
