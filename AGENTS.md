# Agent rules

These rules apply to all agents working anywhere in this project.

## Scope and approval

- Discussion, feature ideas, and architectural exploration are not approval to implement them.
- Implement only work explicitly approved by the user. Work feature by feature so changes remain easy to track and review.

## Branch names and attribution

- Every new branch must use a purpose-based prefix followed by a descriptive name: `<prefix>/<description>`.
- Use prefixes such as `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`, or `build/`. For example: `feat/account-switching`.
- Never use an agent, model, assistant, or AI vendor name as a branch prefix.
- Do not list agents as authors, co-authors, or contributors in commits, pull requests, documentation, or contributor lists. Do not add agent attribution trailers or signatures.
- Preserve the user's configured Git identity; do not invent attribution.

## No emojis

- Do not add emojis to source code, code comments, commit messages, or documentation.

## Consult architecture before feature work

- Before adding or extending a feature, read the project's architecture documentation and any decisions relevant to that feature.
- Use `docs/architecture.md` as the architecture entry point when it is established, and follow its links to relevant documents.
- If architecture documentation is missing, incomplete, or conflicts with the requested feature, flag the gap before implementation. Do not silently invent or override architectural decisions.
- Keep code grouped by capability, with clear ownership and explicit public interfaces. Do not access another module's internal state directly.
- Keep application rules independent of Electron and UI code. Keep provider-specific implementation details behind runtime adapters.
- Core capabilities must not depend on optional features. Connect implementations explicitly in the application's startup composition.
- Prefer changes contained within the responsible modules. Do not introduce speculative abstractions or unrelated refactors to prepare for unapproved features.

## Document changes

- After making changes, update the relevant documentation in the same change set. Explain what changed, why, and any behavior or usage implications.
- Record a concise summary and validation status in `docs/changes.md`. Clearly distinguish checks performed from checks not performed.
- When architecture changes, update the architecture documentation as well, including affected boundaries, dependencies, interfaces, and the reason for the decision.
- Keep documentation consistent with the implemented state. Clearly label proposals and future work; do not describe planned functionality as already available.

## Comment code for understanding

- Code must be thoroughly commented so a developer unfamiliar with the project can understand its responsibilities, behavior, and design decisions.
- Document module responsibilities and public interfaces, including inputs, outputs, side effects, and relevant failure behavior.
- Explain non-obvious control flow, state transitions, invariants, architectural constraints, and tradeoffs close to the code they concern.
- Pay particular attention to asynchronous execution, cancellation, retries, recovery, account switching, session handoffs, and provider workarounds when those behaviors are implemented.
- Explain intent and reasoning instead of merely repeating the code. Use clear names and small units alongside comments.
- Update or remove comments when the corresponding behavior changes. Do not leave misleading explanations or commented-out dead code.
