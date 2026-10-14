import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents } from "../transcript.js";
import { groupConsecutiveTools } from "./tool-groups.js";

test("group tools and orphan outputs without hiding intervening text, thinking or status", () => {
  const folded = foldEvents([
    { type: "tool_request", tool: "read", input: { path: "a" }, toolCallId: "a" },
    { type: "tool_request", tool: "shell", input: { command: "test" }, toolCallId: "b" },
    { type: "tool_result", output: "failed", toolCallId: "b", isError: true },
    { type: "message_delta", text: "Explanation" },
    { type: "tool_result", output: "Unpaired output", toolCallId: "unknown" },
    { type: "tool_request", tool: "read", input: {} },
    { type: "thinking_delta", text: "Reconsider" },
    { type: "tool_request", tool: "read", input: {} },
    { type: "interrupted" },
  ]);
  const groups = groupConsecutiveTools(folded.items);
  assert.deepEqual(groups.map((group) => [group.kind, group.index]), [["tools", 0], ["item", 2], ["tools", 3], ["item", 5], ["tools", 6], ["item", 7]]);
  assert.equal(groups[0]?.kind === "tools" && groups[0].items[1]?.kind === "tool" && groups[0].items[1].isError, true);
  // Grouping preserves the original items, including result payloads.
  assert.deepEqual(groups.flatMap((group) => group.kind === "item" ? [group.item] : group.items), folded.items);
});

test("a growing tool sequence keeps its start index when parallel results update", () => {
  const initial = [
    { type: "message_delta" as const, text: "Start" },
    { type: "tool_request" as const, tool: "read", input: {}, toolCallId: "a" },
    { type: "tool_request" as const, tool: "shell", input: {}, toolCallId: "b" },
  ];
  const first = groupConsecutiveTools(foldEvents(initial).items).at(-1);
  const next = groupConsecutiveTools(foldEvents([...initial,
    { type: "tool_result", output: "done", toolCallId: "a" },
    { type: "tool_request", tool: "read", input: {}, toolCallId: "c" },
  ]).items).at(-1);
  assert.equal(first?.index, next?.index);
  assert.equal(first?.kind === "tools" && first.items.length, 2);
  assert.equal(next?.kind === "tools" && next.items.length, 3);
  assert.equal(next?.kind === "tools" && next.items[0]?.kind === "tool" && next.items[0].finished, true);
  assert.deepEqual(groupConsecutiveTools([]), []);
});
