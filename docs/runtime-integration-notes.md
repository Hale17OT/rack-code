# Runtime integration notes

Status: documentation findings for architecture discussion, 2026-10-11. No integration code or compatibility experiments have been run. Documentation can change; verify against pinned versions before implementation.

## Codex app server

The official documentation describes threads, turns, streamed items, native resume, history reads, client approval requests, and MCP integration. It also describes experimental history injection and dynamic tools; those should not become assumed stable dependencies. Native thread state remains Codex-managed, even when our application owns the user-facing conversation. This does not document a universal transcript interchangeable with Claude.

The documentation exposes account rate-limit queries and updates. It distinguishes local/open-source app-server authentication from commercial or hosted offerings, directing the latter toward Sign in with ChatGPT. Confirm the supported authentication route for the intended distribution model before implementing subscription-account switching.

The reference inspected does not establish a reusable browser window that our UI can directly embed or launch. MCP support offers an integration boundary for app-provided tools; browser compatibility still needs validation. These findings come from the [Codex app-server reference](https://learn.chatgpt.com/docs/app-server), reached through the official developer documentation redirect.

## Claude Agent SDK sessions

The SDK documents native session IDs, resume, and fork. Session history and workspace files are distinct: resuming or forking a conversation does not restore or isolate its filesystem. Prefer explicit native IDs over continuing whichever session happens to be most recent. See [working with sessions](https://code.claude.com/docs/en/agent-sdk/sessions).

The SDK also documents a custom SessionStore with append/load operations. It mirrors native transcript entries after local writes; it does not replace the native session format. Entries must be returned unchanged in meaning and order. This is useful for retaining native continuation data beneath an app-owned session, not converting Claude into a stateless consumer of a universal transcript.

The storage guide documents best-effort mirror writes, possible dropped batches, and an incompatibility between SessionStore and the SDK's file checkpointing option. Do not treat this mirror alone as guaranteed durable application history or assume checkpointing features compose without investigation. See [external session storage](https://code.claude.com/docs/en/agent-sdk/session-storage).

## Permissions and tools

Claude's permission evaluation can resolve tool calls before the canUseTool callback. The documentation recommends PreToolUse hooks for checks that must run on every tool call. App policy needs an explicit mapping into runtime controls; a callback alone is not a complete enforcement boundary. See [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions).

Claude documents WebSearch and WebFetch. These search or retrieve content; they do not establish access to a shared interactive browser tab. See the [tools reference](https://code.claude.com/docs/en/tools-reference).

The SDK supports externally configured MCP servers and app-defined tools. This provides a candidate route for an app-owned browser, subject to implementation and permission validation. See [SDK MCP integration](https://code.claude.com/docs/en/agent-sdk/mcp).

The SDK overview explicitly says third-party developers need prior approval to offer claude.ai login or subscription rate limits in their products. It points developers toward API-key authentication. Supported subscription-account integration is therefore unresolved, not an automatic consequence of wrapping the SDK. See the [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).

## Proposed application boundary

Own the logical session, user-visible history, execution records, selected permission mode, and runtime associations. Preserve native continuation state behind each adapter and use supported runtime mechanisms to resume it. On a runtime handoff, supply relevant application context not already seen by the target runtime. This is a proposed design based on the documentation, not a claim that lossless cross-runtime resume is already provided.

Before implementation, verify account/configuration isolation, supported authentication, complete observable event coverage, transcript recovery, browser/computer tool exposure, and policy enforcement against the actual runtime versions. Pi integration remains unresearched.
