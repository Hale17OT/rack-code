# Change log

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
