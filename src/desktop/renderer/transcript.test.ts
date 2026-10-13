import assert from "node:assert/strict";
import test from "node:test";

import { applyEvent, EMPTY_TRANSCRIPT, foldEvents } from "./transcript.js";

test("adjacent message deltas are coalesced; tools break the run of text", () => {
  const state = foldEvents([
    { type: "message_delta", text: "Hel" },
    { type: "message_delta", text: "lo" },
    { type: "tool_request", tool: "read", input: { path: "a" } },
    { type: "message_delta", text: "done" },
  ]);
  assert.deepEqual(state.items.map((item) => item.kind), ["text", "tool", "text"]);
  assert.equal(state.items[0]?.kind === "text" && state.items[0].text, "Hello");
});

test("thinking deltas are folded into a separate trace and approvals stay out of chat", () => {
  const state = foldEvents([
    { type: "thinking_delta", text: "check " },
    { type: "thinking_delta", text: "the file" },
    { type: "approval_request", request: { id: "approval-1", tool: "shell", input: {} } },
    { type: "message_delta", text: "Ready" },
  ]);
  assert.deepEqual(state.items.map((item) => item.kind), ["thinking", "text"]);
  assert.equal(state.items[0]?.kind === "thinking" && state.items[0].text, "check the file");
});

test("tool results pair with the latest unanswered request; unpaired results are kept", () => {
  const state = foldEvents([
    { type: "tool_result", output: "orphan" },
    { type: "tool_request", tool: "a", input: {} },
    { type: "tool_request", tool: "b", input: {} },
    { type: "tool_result", output: "for b" },
  ]);
  const [orphan, first, second] = state.items;
  assert.equal(orphan?.kind, "tool_output");
  assert.equal(first?.kind === "tool" && first.hasOutput, false);
  assert.equal(second?.kind === "tool" && second.output, "for b");
});

test("missing usage fields stay undefined rather than zero", () => {
  const state = foldEvents([
    { type: "usage", inputTokens: 10 },
    { type: "usage", costUsd: 0.01 },
  ]);
  assert.deepEqual(state.usage, { inputTokens: 10, costUsd: 0.01 });
  assert.equal(state.usage?.outputTokens, undefined);
});

test("failures keep retryability only when the adapter reported it", () => {
  assert.deepEqual(applyEvent(EMPTY_TRANSCRIPT, { type: "failed", error: "x" }).failure, { error: "x" });
  assert.deepEqual(
    applyEvent(EMPTY_TRANSCRIPT, { type: "failed", error: "x", retryable: false }).failure,
    { error: "x", retryable: false },
  );
});

test("native session IDs are recorded as diagnostics, not transcript items", () => {
  const state = foldEvents([{ type: "native_session", nativeSessionId: "n-1" }]);
  assert.equal(state.items.length, 0);
  assert.equal(state.nativeSessionId, "n-1");
});
