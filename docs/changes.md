# Change log

## 2026-10-14 - Git Source Control layout for Changes

- Rebuilt the right Changes surface around compact staged/working-tree/conflict file lists, counts, Git status letters, repository/branch labels, and one selected file's numbered diff. Added inline/split comparison, safe file opening, and close-diff controls. Discovery actions moved into a small options menu. Selection and diff scroll positions survive polling; project/repository switches invalidate stale views.
- Added normalized status records and per-file comparisons to the Projects read contract. The Git adapter parses NUL-delimited porcelain, preserves both sides of partially staged edits and staged changes reverted in the working tree, scopes tracked filenames to the chosen folder, and supplies ordinary conflict patches against ours. File rows remain visible when text/binary/large previews are unavailable. Legacy combined diffs remain available, and Git index bytes stay unchanged by reads.
- Validation performed: Node/renderer type checks, headless build, all 116 tests, desktop build, and whitespace checks passed. New/extended tests cover status groups, scoped/newline filenames, renames/deletions, staged-versus-working comparisons, reverted staged edits, merge conflicts, index preservation, line numbering, and split alignment. Electron checks used the real host and Git reader against temporary repositories and confirmed status letters, separate staged/working previews, numbered lines, two visible split panes, live refresh retaining selection, binary notices, switching projects, all-repository discovery/selection, and unchanged index bytes; screenshots reviewed. Type checks and desktop build were repeated after split-pane adjustments. Not performed: a packaged build, destructive Git actions, or live provider runs.

## 2026-10-14 - Minimal model dropdown and borderless tool groups

- Removed the box and divider around compacted tool-call groups; the count/status row and expandable nested calls remain.
- Replaced the model modal with a small dropdown anchored above the composer. Removed search, visible descriptions, modal heading/backdrop, and the selected-model card. Model names lead to the same reasoning slider and small Fast tag; a back arrow returns to the list and a checkmark closes the dropdown. The shared popover can reposition after content changes so the smaller settings panel stays beside its trigger.
- Validation performed: Node/renderer type checks, desktop build, and whitespace checks passed. An isolated Electron stub-host check confirmed no search or modal backdrop, a 250 px dropdown, borderless groups, list-to-slider re-anchoring, keyboard effort selection, Fast toggling, and Escape dismissing the picker without cancelling the run. Screenshots reviewed. The existing headless test suite was not rerun for this presentation change; no authenticated provider run or packaged build was performed.

## 2026-10-14 - Group tool calls, unify model settings, Escape to stop

- Consecutive tool calls and orphan tool outputs render as one collapsible group with a count and aggregate status. Text/thinking/status messages separate groups; individual calls retain their own details. Stable group keys preserve expansion while streaming. Live, persisted, and imported history share the presentation.
- Replaced the separate model/effort/speed pills with one model-settings modal. Its searchable, provider-grouped model list transforms into the selected model's reasoning slider and compact Fast switch. Change returns to the list; Done closes the modal. Effort/Fast preferences are revalidated against the model; unsupported controls are absent or disabled. Adapters mark speed entries with optional `fast` semantics so the UI sends the correct provider IDs without provider-specific logic.
- Escape uses Stop's cancellation operation for the current session, preserves drafts, and ignores repeated/cancel-pending requests. Menus, model/import modals, and Settings consume Escape before run cancellation; other sessions keep running.
- Validation performed: type checks, headless build, all 111 tests, desktop bundle, and whitespace checks passed. Added tests cover grouping boundaries/stable indices, result preservation, reasoning defaults and stale levels, speed preference migration, and explicit standard/fast mappings. An isolated Electron stub-host check verified grouped/nested disclosure persistence during streaming, collapsed-body hiding, model search and list-to-slider transition, keyboard slider changes, Fast on/off, unsupported models, cross-provider fallback, submitted settings, modal/menu/Settings Escape precedence, cancellation of only the selected session, draft preservation, and no duplicate cancellation after completion. Screenshots reviewed. Not performed: authenticated provider model runs or a packaged build.

## 2026-10-14 - Session file attachments

- Added the composer clipboard icon and an upward-opening menu for Images, Documents, Code and text, and Any file. The native picker supports multiple files; removable filename/size chips stay with each session's draft. Attachment-only messages are supported, imports block sending, failed starts retain files, and sent attachments remain visible and clickable after reload.
- Added session-owned file storage behind the Sessions attachment port, assembled at startup. Copies and manifests live outside projects; execution resolves attachment IDs in the destination session before recording a run, saves descriptors on the run, and supplies quoted file paths through the existing runtime prompt and saved conversation. Limits are 20 files per message and 50 MB per file. Any format can be attached; content interpretation uses runtime tools and local readers. Removed draft copies remain retained; automatic cleanup is deferred.
- Validation performed: type checks, headless build, all 105 tests, desktop bundle, and whitespace checks passed. New tests cover byte-preserving storage/reload, original removal, manifest-name collisions, empty files, invalid paths/IDs, oversized files, cross-session ownership, failed-batch rollback, contract limits, attachment-only execution, native start/resume file references, and rejection before creating runs. An isolated Electron fixture using the real host and storage plus a fake runtime verified upward placement, keyboard navigation/Escape, multi-format selection, chip removal, failed-start preservation, attachment-only sending, runtime access to saved copies, renderer reload persistence, session switching during selection, cancellation, and count-limit errors; screenshots reviewed. Type checks were repeated after the session-loading guard. Not performed: authenticated Codex/Claude attachment reads, native OS picker interaction, document conversion, or a packaged build.

## 2026-10-14 - Scope native continuations to the account runtime context

- Fixed "no rollout found for thread id" after switching a session to another Codex account (manually or through automatic fallback). Session continuations were keyed only by runtime, so the second account tried to resume a native thread that exists only in the first account's isolated `CODEX_HOME`. The same mismatch applied to Claude's per-account configuration directory.
- Continuations now record the account's `runtimeContextId`, and lookups match runtime and context. Switching to a new account starts a fresh native thread; switching back resumes that account's own thread. Continuations saved before this change have no context and are ignored, so an existing session starts one fresh native thread on its next run (the app transcript is unaffected).
- Known gap, not addressed here: a fresh native thread after an account or provider switch does not receive the earlier conversation as context; only imported sessions do.
- Validation performed: `npm run check` (100 tests, including a new account-switch regression test). Not performed: a manual run against two real Codex accounts.

## 2026-10-14 - Speed options, clickable links and paths, app-drawn controls, Changes selection race

- Speed: `RuntimeModel.speeds`/`defaultSpeed` and `speed` on `runs.start`, runs, and adapter input. Codex maps service tiers (plus standard `"default"`) and sends `serviceTierForTurn`; Claude offers Standard/Fast for fast-mode models via the SDK `fastMode` setting and rejects unknown values. A speed pill joins the effort pill; both use the new `components/model-option-picker.ts`. Run details shows speed.
- Links and paths: bare http(s) URLs and conservative path detection in Markdown (text and whole inline-code paths); clickable file targets on activity cards, approvals, and Changes files. New `openPath` bridge call; main resolves paths and reveals rather than opens anything that could execute. `http://` links now open too.
- No native choice controls: Changes repository and Run details pickers use app dropdowns; session import uses the new app checkbox.
- Changes panel: fixed a race where a poll paired the live selection with the previous project's repository list (seen as "Repository unavailable" or a stale panel after switching projects while the window was hidden); the panel also refreshes when the window becomes visible.
- Validation performed: type checks, all 99 tests (new: Codex/Claude speed catalogs and pass-through, path classification, URL/path parsing), and desktop bundle passed. Real-app checks against scratch Git repos and a copy of local project/session lists (no credentials) confirmed project switching and diffs for all three local projects, the app repository dropdown, clickable diff file names, and `openPath` missing/invalid outcomes through main. Stub-host screenshots confirmed the speed pill and menu; a rendering check confirmed link/path styling and click routing. Not performed: opening real files (to avoid launching apps), a live provider run with a chosen speed, and a packaged build. The original "git tree is not working" report could not be reproduced in a visible window; the fixed race is the only failure found.

## 2026-10-14 - Reasoning effort, scrolling dropdowns, background approval badges

- Added reasoning effort end to end: `RuntimeModel.reasoningEfforts`/`defaultReasoningEffort` in catalogs, `reasoningEffort` on `runs.start`, `RunRecord`, and `RuntimeRunInput`. Codex reads `supportedReasoningEfforts`/`defaultReasoningEffort` from `model/list` and sends `effort` on `turn/start`. Claude reads `supportedEffortLevels` and sets the SDK `effort` option, rejecting unknown levels visibly. The composer shows an effort pill limited to the selected model's reported levels; Run details shows the run's effort.
- Popovers are height-capped at 320 px and scroll, with sticky provider group headings, so the model list is a short scrolling box.
- Sessions waiting for an approval show a pulsing hand icon and "Needs approval" in the sidebar (and on collapsed projects), including sessions other than the open one.
- Validation performed: type checks, all 93 tests (new tests for Codex and Claude effort catalogs and pass-through, unsupported Claude levels, and execution recording), and the desktop bundle passed. Codex 0.162.1's generated app-server schema and the installed Claude Agent SDK types were checked for the effort fields. An Electron run of the built renderer against a stub host confirmed the background session badge, the effort pill defaulting to the model default, the 320 px scrolling model list, the effort menu, and the focused approval card (screenshots reviewed). Not performed: a live provider run with a chosen effort, and a packaged build.

## 2026-10-14 - Resizable panels, minimal scrollbars, focused approvals, tables

- Both side panels are resizable by dragging their inner edge (`components/resize-handle.ts`), with keyboard arrows and double-click reset. Widths persist per device (`layout.widths`), keep the main column at least 420 px, and re-fit when the window shrinks or a panel is toggled.
- Scrollbars are minimal app-wide: trackless 4 px thumbs that appear only while hovering the scrolling region.
- Approval overlays show only what is being approved (action, target, diff or arguments, reason), described through the same `presentTool` mapping as activity cards. Account, model, run/attempt, and request ID were removed from the overlay; `ui-spec.md` updated accordingly.
- Thinking traces drop the "Thinking trace"/"Reasoning summary" label and caret; a lightbulb beside the text collapses it to one line. Vertical margins and left padding are halved. The summary/trace distinction moved to the button's accessible name and tooltip.
- Markdown supports GitHub-style pipe tables: alignment, escaped pipes, inline formatting in cells, ragged rows, and horizontal scrolling for wide tables. Incomplete tables stay paragraphs while streaming.
- Validation performed: type checks, all 90 tests (3 new table parser tests), and the desktop bundle passed. An Electron 44 run of the built renderer against a stub host confirmed a pointer drag resizes the sidebar to 360 px with saved width and ARIA value, and screenshots confirmed table rendering in light and dark themes. Not performed: visual checks of the approval overlay and thinking panel with live provider events, scrollbar hover appearance, and a packaged build.

## 2026-10-14 - Native automatic permissions and active-run progress

- Replaced Approve for me’s Ask me placeholder with provider-owned review: Codex workspace-write/on-request with `approvalsReviewer: "auto_review"`, and Claude SDK `permissionMode: "auto"` without the Rack interactive approval callback. Apply explicit settings to new/resumed threads and Codex turn starts. Provider denials remain denials; unexpected Codex manual prompts fail visibly instead of silently asking or granting access.
- Preserve approved Claude tool input in native responses and explicitly deny mutation callbacks in planning/read-only mode. Updated permission disclosures and documentation.
- Keep the permission picker bound to the actual active run mode and disabled until it ends, preventing misleading mid-run changes.
- Hide response timestamp footers during queued/running work and show animated three dots until terminal status. Keep animation phase through streaming redraws and honor reduced motion.
- Validation performed: type checks, all 83 tests, desktop bundle and whitespace checks passed. Tests cover all native permission mappings, resumed runs, read-only denial, approved input preservation, and prevention of interactive fallback from auto review. The installed Codex 0.162.1 generated schema and an isolated ephemeral thread-start smoke check confirmed native `auto_review` support without starting a model turn. Browser fixture checks confirmed three dots and no timestamp before/during streaming, disabled permission picker while active, and timestamp/picker restoration after completion. No authenticated provider model run or packaged Electron check performed.

## 2026-10-14 - Quiet response footers, streaming, and side diffs

- Reduced response footers to date/time. Moved account/model/permission, status, recovery and journal diagnostics into a right-panel Run details surface with a run picker; Stop remains in the composer.
- Preserved Claude readable content from initial streamed blocks and deduplicated final messages. Added checks that thinking and responses reach the live view before completion.
- Replaced the Changes placeholder with a read-only project Git diff: staged/unstaged changes against HEAD plus bounded new text files, with binary/large-file notices, per-file dropdowns and highlighted additions/deletions. Poll while visible, serialize reads and discard replies for a different selected project. This is current project state, including pre-existing edits, rather than per-run attribution.
- Validation performed: type checks, all 80 tests, desktop bundle and diff whitespace checks passed. Git fixtures covered index preservation, staged/unstaged edits, new/binary files, unborn repositories, subfolder scope and non-Git folders. Browser fixture checks confirmed streaming before completion, timestamp-only footers, highlighted side diffs, collapsed tool bodies, and Allow without cancellation; reviewed a screenshot. No live provider execution or packaged Electron check performed.

## 2026-10-14 - Rearrange sidebar folders and sessions

- Added sibling-scoped drag/drop ordering and Alt+Up/Down keyboard moves with local preference persistence, drop indicators, stale-ID cleanup, and newly added row handling. Project identity and session associations remain owned by the host.
- Reduced folder-row and tool-dropdown vertical padding.
- Validation: type checks, all 75 tests (including saved-order reconciliation and sibling moves), desktop bundling, and diff whitespace checks passed. Tests/build required an elevated rerun because the sandbox blocked the tsx IPC socket. No visual drag/drop interaction test performed.

## 2026-10-14 - Collapse command activity into status dropdowns

- Show tool activity as compact, initially collapsed rows with live status and a command/target preview. Reveal detailed commands, output and diffs only when expanded; preserve the existing expansion memory during streaming.
- Explicitly hide closed activity bodies and reserve the boxed panel appearance for expanded rows.
- Validation performed: type checks, all 73 existing tests, and desktop bundling passed. Visual browser validation and live provider execution were not performed.

## 2026-10-14 - Keep approval responses from stopping execution

- Set Allow and Deny to ordinary buttons inside the composer form. Previously, answering an approval also submitted the form and triggered cancellation of the active run.
- Validation performed: type checks, all 73 existing tests, and the desktop bundle passed. Live provider execution and browser click validation were not performed.

## 2026-10-14 - Batch session import and readable runtime activity

- Added import checkboxes, Select all for not-yet-imported sessions, selection counts, independent previews, and batch import with preserved successes and retryable failed selections.
- Simplified the composer permission menu to Ask me, Approve for me, Full access, and Read only, without descriptions. Runtime enforcement and diagnostic mappings are unchanged.
- Display provider-exposed thinking as open prose, with summaries labelled separately. Retain thinking/tool activity at run completion and reconstruct saved activity from journals. Enable Claude partial messages and avoid duplicating final streamed content.
- Added formatted tool cards for commands, file targets, diffs and output, with outcomes, exit codes and durations. Correlate parallel tools by call ID; streamed output does not imply completion. Retain readable thinking and paired Claude tools during import.
- Validation performed: type checks, 73 tests including Select all, partial batch failure, journal restoration, streaming trace deduplication, tool identity/output correlation and formatting, headless build, desktop bundle, Markdown links/fences, and diff checks. No live provider execution or visual browser validation was performed; computer use reported no available browser in this session.

## 2026-10-14 - Import local provider sessions into projects

- Added project-scoped Codex app-server and Claude SDK history sources, partial discovery failures, and preview/import host commands. Imported native IDs are provenance, not assumed resume handles. Concurrent/repeated imports reuse a session; source folder and identity are checked before saving a complete snapshot.
- Added the project-row import action, preview dialog, imported conversation/tool history, and fresh-context continuation. The first run receives recent visible conversation as background while preserving the real user prompt, selected permissions/account, and external session.
- Updated architecture, MVP, desktop, and UI documentation and added `session-import.md`.
- Validation performed: type checks, 62 tests covering parsing/pagination/timeouts, folder scope, idempotency, partial failure, durable host import/reload, and continuation; headless build, desktop bundle, and Markdown/diff checks. Inspected installed Codex-generated schemas and Claude SDK types. A local Claude helper check returned no matching sessions in the tested folder. Codex initialization against its original store exited in this sandbox; copied stores returned no discoverable sessions, so native live-history import remains unverified.
- Not performed: live model execution, imports into the user's real Rack data, or visual UI verification. The browser CLI could not write its socket directory, and computer use reported no available browser. No screenshot-based validation is claimed.

## 2026-10-14 - Consolidate duplicate folder projects

- Found two saved project IDs pointing at the same folder. Upgraded projects to schema 4 with one canonical project per normalized path and persistent aliases for former duplicate IDs. Sessions and execution upgrade to schema 3 and resolve those aliases before returning saved history to the UI. Conflicting active writers stop migration rather than silently losing ownership.
- Repeated or concurrent folder additions reuse the existing project. Serialized project creation and writer mutations prevent competing requests from creating another identity or acquiring two writer locks.
- Validation performed: 53 tests, type checks, headless build, desktop bundle, local Markdown links/fences, and `git diff --check`. Verified through the host API against a temporary copy of the user's saved metadata: 2 projects became 1 while preserving all 3 sessions, 6 runs, 93 journal entries, attempts, outcomes, and native continuations. The original app data was not edited directly.
- Not performed: visual validation or restarting the live Electron app. The running host caches its loaded data; a full app restart with the rebuilt bundle applies the upgrade.

## 2026-10-14 - Use one project identity for the selected folder

- Replaced workspace-named services, records, host commands/events, session/run references, model discovery inputs, and renderer state with the single project concept. The sidebar, folder picker, transcript, and error messages now consistently say Project. Removed shared/isolated kind from the project model; future isolated execution directories remain associated with a project.
- Added automatic upgrades to projects schema 3 and sessions/execution schema 2. Preserved saved folder IDs, session messages, native continuations, attempts, journal entries, run outcomes, revisions, and writer ownership. Imported all folders from older project/workspace documents before new saves, including partial imports. Retained the legacy workspace file and sidebar expansion preferences.
- Reject a run whose project differs from its session before recording work or calling a runtime. Updated the architecture, MVP, desktop, and UI documentation to match the new contracts.
- Validation performed: Node and renderer type checks, headless TypeScript build, 48 tests (including migration/reload, partial import, corrupt legacy data, canonical host identity, and mismatched-project rejection), desktop bundle, local Markdown links/fences, and `git diff --check`. Used `node --import tsx` for the test runner and desktop build because the tsx CLI's IPC socket is restricted in this session.
- Not performed: live provider execution or visual Electron validation. The earlier Electron launches in this session aborted during macOS application initialization.

## 2026-10-13 - Unify workspace navigation and remove setup text fields

- Replaced the separate project tree and workspace list with one workspace folder tree. Sessions nest beneath their workspace, and the workspace plus button creates a session immediately with a generated title.
- Workspace creation now uses only the native folder picker. The selected folder supplies the project name and shared workspace path, so project, workspace, path, starting-revision, and session-title input boxes are absent from the setup flow.
- Loaded workspaces across all projects for the unified navigator and improved sidebar row/button padding for clearer click targets.
- Validation performed: `npm run check` (41 tests), plus `git diff --check`. The local Electron app was launched from `dev` and the unified workspace tree rendered without setup input fields.

## 2026-10-13 - Restore the chat transcript after the model picker merge

- The merge of the model picker branch (`0b131ec`) resolved the renderer conflicts in favor of that branch, which predated the chat transcript, so the session view and its styles fell back to run cards. Reapplied the chat transcript (prompt bubbles, Markdown replies, meta row, tool rows, turn navigator, "Scroll to end") on top of the merged state.
- Kept the model picker branch's behavior: thinking traces render as a collapsed "Thinking" row in the tool-row style, pending approvals stay in the composer overlay instead of the transcript, user-message metadata stays hidden, and the reply meta row no longer shows the runtime because the selected model determines it. Composer, model catalog, host, and adapter code were not changed.
- Validation performed: `npm run check` passes (41 tests). In the running app with throwaway test data, a session rendered three chat turns (prompt bubbles, the clipped long prompt, Markdown replies, meta rows) and no run cards.
- Not performed: streaming, thinking rows, tool rows, and the approval overlay during a live run.

## 2026-10-13 - Unified model selection and composer approval overlay

- Added provider-backed model discovery to the host `models.list` catalog and runtime adapter model contracts. Codex reads the paginated app-server `model/list` catalog and Claude reads Agent SDK `supportedModels()` in an idle, non-persisted query. The host queries every connected account, deduplicates entries, keeps account provenance, reports partial failures, and refreshes after account/workspace changes.
- The composer now presents a list-only Claude/Codex model catalog, routes the selected model to its owning provider/runtime internally, filters account choices to that provider, and explains empty or partial discovery results. There is no runtime picker or free-form model editor.
- Removed expandable user-message metadata from the transcript, added normalized thinking traces, and kept tool calls visible.
- Moved pending approval cards out of the transcript into an overlay above the prompt composer. Approvals remain brokered by the host and survive renderer reconnects.
- Validation performed: `npm run typecheck`, `npm test` (38 tests), and `npm run build:desktop` pass. Live provider execution and a real approval response were not run.

## 2026-10-12 - Simple chat transcript

- Replaced run cards with a Codex/T3-style chat. Prompts are right-aligned bubbles with clipping for long text. Replies are Markdown-rendered page text with a meta row (copy, time, labels, Details, Stop), compact expandable tool rows, inline approval cards, a turn navigator, and a "Scroll to end" pill. Run details moved behind the per-reply Details toggle.
- Added `markdown.ts`, a pure parser with a DOM renderer that uses text nodes only, and tests for blocks, streaming fences, inline markup, and rejection of non-http links.
- Validation performed: `npm run check` passes (37 tests). In the running app, a session with completed turns in the throwaway test data rendered prompt bubbles, the clipped long prompt, inline code, bold, a numbered list, a code block, and meta rows.
- Not performed: streaming, tool rows, and approvals during a live run.

## 2026-10-12 - Connect Codex and Claude accounts

- Added a Connections core module (`src/core/connections/`) with the `AccountConnector` port and `ConnectionsService`. The service allocates a fresh runtime context, runs the provider sign-in there, and registers the account (or re-authenticates an existing account with the same identity onto the new context) with a `native_login` credential reference. It marks the account available and selects it when the provider has no selection.
- Added `CodexConnector` (app-server `account/login/start` ChatGPT flow) and `ClaudeConnector` (`claude auth login --claudeai` with an isolated `CLAUDE_CONFIG_DIR`), plus `NativeLoginCredentialResolver`, which the composition root now always wraps around the supplied resolver.
- Host contract: `auth.providers`, `auth.connect`, `auth.submitCode`, `auth.cancel`, `auth.active`, the `auth.updated` event, and the `connector_not_found` and `connect_not_found` codes. Host shutdown cancels sign-ins.
- UI: Settings, Accounts now shows "Connect Codex account" and "Connect Claude account" buttons, sign-in progress cards (open sign-in page, device code, code field, cancel, try again), and Reconnect on saved accounts. The manual credential-reference forms were removed from the UI; `accounts.register` remains for headless embedders. The composer shows "Connect an account" when no account exists.
- Validation performed: `npm run check` passes (34 tests, including connect, reconnect, cancel, and error-code tests with a fake connector). A live Codex probe returned a real sign-in URL and cancelled. `claude auth status --json` was checked against an empty isolated directory. The Accounts pane renders both connect buttons.
- Not performed: completing a real Codex or Claude sign-in, or a run with a connected account. Both need the user's interaction.

## 2026-10-12 - Native folder picker for projects and workspaces

- Creating a project now opens the native folder picker, then a small "New project" dialog pre-filled from the chosen folder (name, path with Browse, root-workspace checkbox). The workspace form's path field also has a Browse button. The empty sidebar state is now an "Add a project folder" button.
- Added `selectDirectory` to the preload bridge and a `harness:select-directory` IPC channel handled by Electron main, which validates the sender and options and returns only the chosen path. This is a desktop-shell operation, not a host command.
- Added a reusable modal component (`components/modal.ts`) with Escape, backdrop click, focus trapping, and focus return.
- Validation performed: `npm run check` passes. In the running app, the folder-plus button opened the native macOS picker titled "Choose project folder", attached to the window.
- Not performed: choosing a folder in the native dialog and submitting the dialog end to end (it needs manual interaction); testing on Windows or Linux.

## 2026-10-12 - Retractable sidebars, surface launcher, condensed tree

- Both sidebars are retractable from a new slim toolbar that also shows the session title. A collapsed left sidebar reappears on hover at the window's left edge and floats over the content.
- The right sidebar is now an "Open a surface" launcher with single-key shortcuts. Changes is always listed, and plugin surfaces appear when enabled in the new Settings, Plugins toggles. All plugins are labelled previews with no functionality.
- The sidebar is now a folder tree with nested, condensed single-line session rows showing relative age, and workspace rows are condensed too. The type scale is smaller throughout (wordmark, titles, and body text).
- Validation performed: `npm run check` passes. In the running app, checked that enabling Terminal and Timeline lists them in the launcher, that the T shortcut opens the Terminal surface, that collapsing the left sidebar keeps the grid intact, that hover peek reveals the sidebar, and the tree rendering in light and dark.
- Not performed: a live agent run, so the running spinner was not observed with a real provider; testing on Windows or Linux.

## 2026-10-12 - Restructure the desktop UI layout

- Replaced every native `<select>` with a custom, keyboard-accessible dropdown (`components/dropdown.ts`) rendered in a shared popover (`components/popover.ts`).
- Rebuilt the composer as one card: an auto-growing prompt and a toolbar of pill menus (permission, account, model) plus a round send button that becomes a stop button while the session has an active run. Capabilities and native permission mappings moved into the menu option descriptions. Enter now sends.
- The sidebar's upper part is now a sessions tree grouped under project folders, with inline new-session forms and running spinners. Workspaces of the current project are below it, and Settings is at the bottom. The project form can optionally add a shared workspace at the root path; this is an explicit checkbox, not an implicit policy.
- The right panel is now reserved for code changes, diffs, and plugins, and shows empty states. Run details expand inline in the transcript instead of in the right panel.
- Added a Settings overlay. General holds the Light/Dark/System appearance choice, Accounts holds account management, and Permissions, Plugins, Shortcuts, Notifications, About, Startup, and Exit behavior are labelled placeholders.
- Contract change: `sessions.list` accepts an omitted `projectId` to list sessions of every project for the tree.
- Validation performed: `npm run check` passes (typecheck, build, 31 tests, desktop bundle). In the running app, checked dark and light themes, the theme choice in Settings and its persistence, menus opening upward with grouped and wrapped options, keyboard selection in a dropdown, creating a session from a folder's inline form, the inline run details, and the Accounts pane in Settings.
- Not performed: a live agent run, so the running spinner and the stop button were not observed with a real provider; testing on Windows or Linux.

## 2026-10-12 - Implement the first desktop UI

- Added the Electron desktop app (see `docs/desktop.md`). Application services run in a separate execution host utility process that owns every in-flight run and pending approval. Electron main validates renderer requests at the privileged boundary and relays them. A two-function preload bridge (`window.harness`) is the renderer's only privileged API.
- Recorded the user's decisions: a framework-free TypeScript renderer with plain CSS, and a utility-process host chosen for maintainability and future background mode. Updated the architecture technology table and source layout.
- Added serializable desktop contracts in `src/contracts/desktop/` (typed command map with runtime validators, host events, views, and stable error codes with structured details).
- Added core read queries for the UI: project, workspace, and session lists, run lists per session, attempt lookup, ordered journal reads, and runtime registry listing. Added typed execution errors (`NoEligibleAccountError`, `WorkspaceProjectMismatchError`, `AttemptNotFoundError`), structured fields on `WorkspaceBusyError` and `DuplicateAccountError`, and `RuntimeAdapter.describePermissionMode` so permission mappings are disclosed by adapters.
- Renderer: sidebar navigator with a spinning indicator on sessions that have an active run, streaming transcript with tool rows and approval cards, run composer with capability-gated permission modes and an unknown-outcome acknowledgement guard, a run inspector (usage, mappings, recovery details, journal), and account management. It offers Light, Dark, and System appearance, Phosphor icons, and bundled Inter and IBM Plex Mono fonts. There are no status indicator dots.
- Stop-on-exit: quitting with active runs asks for confirmation, then cancels them through the host and waits up to 10 seconds before terminating it.
- Validation performed: `npm run check` passes (both TypeScript projects, the headless build, 31 tests including new host-API, contract-validator, and transcript tests, and the desktop bundle). The unpackaged Electron app was launched with an isolated data directory and driven through the real bridge: creating a project, workspace, session, and accounts; duplicate-account and invalid-input errors; starting a run (which failed as expected without credentials); reloading the renderer; switching tabs and appearance; and quitting, after which no Electron or host processes remained.
- Not performed: a successful live agent run (the host has no credential source yet), the approval and cancellation flows against a real provider, visual verification of the session spinner during a live run (covered by code paths and host tests only), packaging, and testing on Windows or Linux.

## 2026-10-12 - Implement headless MVP runtimes and composition

- Added account credential replacement for re-authentication, in-memory credential resolution for tests/embedding, and private per-account runtime-context directories.
- Added durable JSON stores for accounts, projects, sessions, executions, and the append-only journal, with atomic writes and schema-version envelopes.
- Added Codex app-server and Claude Agent SDK adapters behind the provider-neutral runtime contract. They isolate native configuration, translate streaming/tool/approval/usage/availability/completion events, support native resume, and handle cancellation.
- Added the explicit `createApplication` composition root and a public headless API entry point. No UI or Electron renderer was added.
- Added fake-runtime, cancellation, continuation, durable-store, and context-isolation tests, plus `docs/mvp.md` and the post-implementation UI contract in `docs/ui-spec.md`.
- Validation: `npm run check` and `git diff --check` pass. Live provider execution with user credentials was not run; browser/computer-use and background-host features remain deferred.

## 2026-10-12 - Implement accounts domain foundation

- Added the TypeScript/npm project foundation and Node-based build and test scripts.
- Implemented the Accounts capability with provider-scoped identities, opaque credential references, isolated runtime-context IDs, availability observations, account selection, deterministic eligible-account failover, and usage tracking.
- Added an in-memory store for headless composition and tests; provider authentication and durable persistence remain behind separate interfaces.
- Added account capability documentation in `docs/accounts.md`.
- Validation: `npm run check` passes. No provider SDK, credential, or Electron integration was exercised.

## 2026-10-12 - Accept Claude Agent SDK wrapper direction

- Accepted the Claude Agent SDK wrapper model for the product and removed subscription authentication as a technical implementation blocker.
- The Claude adapter will use documented subscription OAuth authentication and per-account configuration contexts, with API-key and other provider modes represented separately where supported.
- Kept credential isolation, native session isolation, and source-term traceability as implementation requirements.
- Validation: reconciled the decision with the current Agent SDK overview, authentication documentation, and Commercial Terms. No runtime authentication or account-isolation experiment was run.

## 2026-10-12 - Clarify SDK product-use and terms conditions

- Confirmed that the Agent SDK is explicitly intended to embed Claude Code's agent loop in a developer application, and that Anthropic's Commercial Terms permit using Services to power products for a customer's own users.
- Recorded the accompanying limits: the Commercial Terms restrict competing products or resale unless expressly approved, and the SDK documentation calls for prior approval for third-party claude.ai login or subscription rate limits.
- Clarified that these are product-use and authentication conditions, not a technical limitation of the SDK. The wrapper architecture and subscription mechanisms remain technically feasible.
- Validation: reread the current SDK overview and the linked Commercial Terms. No legal determination, login, credential access, or runtime experiment was performed.

## 2026-10-12 - Verify Claude SDK subscription mechanisms

- Rechecked the official Agent SDK overview, quickstart, TypeScript reference, authentication guide, and environment-variable reference.
- Documented subscription OAuth token support, account-specific configuration directories and credential storage, per-process SDK environments, account inspection, and rate-limit events.
- Corrected the architecture to distinguish documented technical subscription support from the SDK's separate third-party product approval condition. BYO subscriptions and multiple accounts remain required.
- Validation: fetched and read the current official documentation and checked the documentation diff for whitespace errors. No login, token generation, credential access, SDK execution, or account-isolation experiment was performed.

## 2026-10-12 - Confirm subscription and multi-account scope

- Confirmed that BYO subscription authentication is required for both Codex and Claude, and that multiple saved and selectable accounts are required in the first release.
- Clarified that an API-key-only Claude integration would not satisfy this product scope.
- Kept Claude subscription access as an explicit external feasibility gate because the official Agent SDK documentation requires prior Anthropic approval for third-party claude.ai login or subscription rate limits.
- Validation: reconciled the requirement with the runtime adapter boundary and official integration documentation. No application code or runtime compatibility test was run.

## 2026-10-12 - Make BYO subscriptions and account isolation first-release requirements

- Confirmed that users bring their own Codex and Claude subscriptions and that multiple accounts must work in the first release.
- Defined provider-neutral contracts concretely: core code consumes application-owned run inputs, normalized runtime events, capability flags, and opaque credential references; Codex and Claude protocol types remain inside their adapters.
- Required separate credential, token-cache, native-session, and runtime-configuration contexts for concurrent accounts.
- Recorded Claude subscription authentication as a release feasibility gate because the official Agent SDK documentation requires prior Anthropic approval for third-party claude.ai login or subscription rate limits.
- Validation: reviewed the architecture boundaries and current official Codex and Claude integration documentation. No application code or compatibility experiment was run.

## 2026-10-12 - Select initial runtime integrations

- Confirmed that the first product scope supports both the Codex app server and Claude Agent SDK.
- Defined the product as a provider-neutral wrapper: each runtime is a first-class adapter behind shared application contracts, and future runtimes such as Pi should be addable without changing core sessions, execution, permissions, or persistence.
- Kept authentication scope, account isolation, and automatic account switching open for the next foundational decision.
- Validation: reviewed the decision against the architecture's adapter and dependency boundaries. No application code or runtime compatibility tests were changed.

## 2026-10-12 - Set workspace and recovery direction

- Documented shared workspaces for sequential handoffs and account failover, one app-managed editing run per shared workspace, and isolated workspaces for independent parallel work.
- Made the execution host the logical owner of application state, with current-state records and an append-only execution journal. Documented atomic state updates where possible and explicit handling of external actions with unknown outcomes.
- Kept uncommitted-change transfer, non-Git isolation, storage engine, retention, and backup choices open for their implementation discussions.
- Validation: reviewed the architecture against the user's accepted direction and checked local Markdown links, code fences, and emoji rules. No application tests apply to this documentation change.

## 2026-10-11 - Clarify execution, sessions, and built-in features

- Recorded default stop-on-exit behavior and optional background work, with an independent execution-host boundary proposed for discussion.
- Clarified first-party feature toggles, the intended terminal presentation, four app-owned permission modes, and the shared manual/agent browser requirement.
- Added sourced runtime notes covering native session ownership, Claude's session mirror, approval controls, and documented authentication constraints affecting distribution.
- Kept workspace concurrency, storage details, exact background shutdown semantics, browser implementation, and permission-mode mappings open. No application code was added.
- Validation: read official runtime documentation through the desktop browser and checked local Markdown links, code fences, and emoji rules. No runtime integration tests were performed.

## 2026-10-11 - Set Node.js tooling baseline and record architecture gaps

- Removed Bun from the active architecture and adopted npm with Node.js tooling alongside Electron and Husky, following the user's direction.
- Documented unresolved boundaries around runtime feasibility, process lifetime, sessions, permissions, workspace concurrency, persistence, optional modules, and terminal/distribution behavior.
- Kept those questions open for discussion; no scaffold or application behavior was implemented.
- Validation: reviewed the updated architecture against project rules and prior requirements; checked local links, Markdown fences, and removal of Bun from the active document. No runtime tests apply to this documentation-only change.

## 2026-10-11 - Draft project architecture

- Added `architecture.md` as the architecture entry point, capturing the product direction, core and optional module ownership, adapter boundaries, session continuity, and incremental implementation approach.
- Recorded TypeScript, Electron, and Husky as user-selected directions. Proposed Bun for package management and development scripts while leaving a separate Bun backend and application service placement open for discussion.
- Distinguished proposed structures and unresolved integration behavior from implemented capabilities. No application scaffold, dependency installation, Git initialization, or hooks were created.
- Validation: checked the runtime distinction against Electron and Bun documentation and confirmed Husky documents Bun installation. Reviewed local documentation links and the draft for consistency with the project rules. No runtime compatibility tests have been performed.

## 2026-10-11 - Establish agent rules

- Added root `AGENTS.md` with project-wide rules for branch prefixes, attribution, emoji-free code and documentation, architecture consultation, change documentation, and code comments.
- Recorded the requirement to implement only explicitly approved work, feature by feature.
- Reserved `docs/architecture.md` as the future architecture entry point. No architecture document or application implementation exists yet.
- Validation: reviewed the rules against the user's requirements. No runtime tests apply to this documentation-only change.
