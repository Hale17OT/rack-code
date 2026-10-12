# Change log

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
