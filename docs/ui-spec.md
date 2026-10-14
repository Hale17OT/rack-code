# UI specification

Status: specification for the completed headless MVP, updated 2026-10-13. The first desktop implementation of this contract is described in [desktop application](desktop.md); deviations and gaps are listed there under "Known gaps".

The UI talks to an application host through typed commands and serializable snapshots/events. It never reads JSON files, provider credentials, SDK objects, or native runtime protocol messages directly. The host exposes the operations already implemented by `createApplication` and should add thin list/read queries where the current service surface does not yet provide one.

## Accounts

The account view is provider-scoped. It shows provider name, safe identity fields, availability, quota reset time, selected state, last-used time, and whether an attempt is currently using the account. It never displays credential material, environment variables, runtime-context paths, or native session files.

Supported interactions:

- **Add account:** the desktop UI offers "Connect <provider> account". The host's Connections module runs the provider sign-in in a fresh runtime context and registers the account with an opaque `native_login` reference (see [desktop application](desktop.md)). Headless hosts can still register an account directly with provider, safe identity, credential reference, authentication method, and runtime-context ID. On duplicate provider identity, show the existing account and explain that the same provider identity cannot be added twice.
- **Select account:** call `accounts.select(providerId, accountId)`. Selection affects future attempts only; show active attempts with their original account.
- **Re-authenticate:** after the host obtains a replacement credential, call `accounts.reauthenticate`. Show the account as `unknown` while it is rechecked. The operation may rotate the runtime context and clears stale reason/reset details.
- **Refresh availability:** render adapter observations as they arrive. `unknown` means no successful health observation exists, `available` is eligible, `unavailable` means the provider reported a temporary limit/failure, and `reauth_required` means the account needs authentication before a new attempt can use it.

When starting a run without an explicit account, the UI should show the selected account and the chosen account in the run confirmation. If the selected account is unavailable, the host may choose the most recently used available account for that provider; the UI must display that fallback in the attempt metadata.

## Project and workspace context

Before starting a run, the UI selects a workspace folder, model, account, and permission mode. Project and workspace are presented as one folder concept in the desktop navigator; the host still keeps their IDs separate for session ownership and execution records. Adding a folder through the native picker derives the project name and creates a shared root workspace automatically. The model catalog is a list-only control: it queries every connected account through `models.list`, groups returned entries by provider, and never accepts a free-form model string. Provider and runtime routing are host metadata and are not user-facing controls. The host may return partial account discovery failures alongside successful entries; show available entries and a clear warning for failed accounts. If the catalog is empty, explain that a provider account must be connected or rechecked and keep the run action disabled. Refresh the catalog after account changes and when the selected workspace changes. A workspace shows its path, kind (`shared` or `isolated`), starting revision when present, and active writer attempt when present. Workspace and session creation do not expose editable text fields; paths come from the native folder picker and session titles use generated defaults.

The current host operations are `projects.createProject`, `projects.createWorkspace`, `projects.getProject`, and `projects.getWorkspace`. A production UI needs list queries composed over the project store before presenting a project/workspace navigator. Starting an editing run against a busy shared workspace shows the owning attempt and offers retry after it releases; it does not silently start a second writer.

## Session and run lifecycle

The session view renders application messages in order and labels each run with account, model, workspace, permission mode, attempt, and status. Runtime/provider routing remains diagnostic host metadata rather than a user-facing selector. Application session IDs remain stable across provider changes. Native Codex thread IDs and Claude session IDs are diagnostic continuation metadata and should not replace the application session identity.

The run status presentation is:

| Status | UI state | User actions |
| --- | --- | --- |
| `queued` | Waiting for workspace and runtime | Cancel; inspect selected account/workspace |
| `running` | Streaming transcript and tool activity | Respond to approval; cancel |
| `completed` | Completed result and persisted assistant message | Start another run; continue session |
| `failed` | Provider or host error with error text | Retry after reviewing account/workspace; re-authenticate when indicated |
| `interrupted` | User or runtime interruption | Continue with a new run; inspect partial transcript |
| `unknown` | Provider ended without a terminal outcome | Do not replay side effects automatically; inspect journal and decide whether to continue |

The host returns an `ExecutionHandle` with `events`, `completed`, `respondToApproval`, and `cancel`. The UI subscribes to `events` once per handle and awaits `completed` for the authoritative final snapshot. It should preserve events received before a renderer reconnects by querying the persisted run/journal through the host; reconnecting must not start another attempt.

## Streaming transcript and tools

Render `message_delta` events as incremental assistant text, coalescing adjacent deltas for display while preserving journal order for recovery. Render `thinking_delta` events as a separate collapsed thinking trace. Render `native_session` as a non-user-visible association in run details. Render `tool_request` with tool name and structured input, and pair a later `tool_result` when available. Unknown tool shapes must be shown as expandable structured data rather than discarded.

Usage events may contain input tokens, output tokens, and estimated cost. Show missing fields as unavailable, never as zero. Availability events update the account card and the run detail without changing the active attempt's account.

## Approvals

An `approval_request` pauses the runtime until the user responds. Render the request as an overlay above the prompt composer, not as a chat message. Show the request ID, tool, structured input, reason, account, workspace, and run/attempt. The only MVP decisions are `allow` and `deny`; call `respondToApproval` with the exact request ID. An expired or already answered ID shows an error and leaves unrelated approvals untouched.

`read_only` denies through the core broker before a provider callback can authorize an action. `ask` presents each provider approval. `approve_for_me` currently presents the same approval interaction as `ask`; the UI must label that behavior accurately. `full_access` suppresses the approval interaction while the adapter applies its provider-specific bypass setting.

## Cancellation and interruption

The cancel action is available while queued or running and is idempotent from the UI's perspective. Disable duplicate submissions after the first request, continue consuming events until the terminal `interrupted` state, and then refresh the workspace lock. A renderer disconnect is not cancellation; the host owns the run and retains pending approvals for a future client.

## Error and recovery states

Map domain errors to actionable messages: duplicate account, provider mismatch, missing account/project/workspace/session/runtime, busy workspace, missing approval, and invalid input. Preserve the stable error class/code in the host response so the UI does not parse English messages.

For `failed`, show the provider error and whether the adapter marked it retryable. For `unknown`, show the last journal sequence and last known native continuation; require an explicit user decision before retrying a side effect. For `reauth_required`, route to the account re-authentication flow. A provider rate-limit event may mark an account unavailable with a reset time; the UI should offer another eligible account for a new attempt without altering the current attempt.

## Runtime and capability disclosure

The model picker calls `models.list` and groups model entries from all connected accounts by provider. The selected entry supplies the hidden `providerId` and `runtimeId` for `runs.start`; there is no runtime picker or model text field. Capability flags returned by `runtime.capabilities` still control permission options for the selected model's adapter: resume, fork, approvals, quota reporting, browser tools, and computer use. Disable or explain controls whose capability is false. Do not infer capability from provider names in the renderer.

Permission mapping must be shown in the run details because the same app mode maps to different native controls. Claude `read_only` uses plan mode; Codex uses a read-only sandbox. Claude and Codex full access both bypass their native approval checks within the host's available permissions.

## Background and reconnect behavior

The MVP has no background execution host or Electron lifecycle implementation. A future UI may distinguish window disconnect from host shutdown, but it must not claim that closing a window stops or preserves work until that host contract exists. For the current headless host, the caller owns the process lifetime and should consume or explicitly cancel active handles before exit.

## UI prerequisites and deferred features

The first UI implementation added host-facing list/read queries for projects, workspaces, sessions, runs, and journal entries (`ProjectsService.listProjects`/`listWorkspaces`, `SessionsService.list`, `ExecutionService.listRuns`/`getAttempt`/`listJournal`, `RuntimeRegistry.list`) while keeping their data ownership in the existing services/stores. It should not add persistence tables, provider conditionals, or credential handling to the renderer. Timeline, retrospective, orchestration, browser integration, remote relay, background mode, native transcript mirrors, automatic credential refresh, and isolated workspace creation are outside this MVP specification.
