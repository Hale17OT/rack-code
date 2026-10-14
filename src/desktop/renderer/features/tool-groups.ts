/**
 * Presentation-only grouping after event folding. Preserve item indices for
 * disclosure keys; text, thinking and status messages always break a group.
 * This leaves tool/result correlation and the persisted journal untouched.
 */
import type { TranscriptItem } from "../transcript.js";

export type ToolItem = Extract<TranscriptItem, { kind: "tool" | "tool_output" }>;
export type TranscriptGroup =
  | { readonly kind: "item"; readonly index: number; readonly item: TranscriptItem }
  | { readonly kind: "tools"; readonly index: number; readonly items: readonly ToolItem[] };

export function groupConsecutiveTools(items: readonly TranscriptItem[]): readonly TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  let pending: ToolItem[] = [];
  let start = 0;
  const flush = () => {
    if (pending.length === 0) return;
    groups.push({ kind: "tools", index: start, items: pending });
    pending = [];
  };
  items.forEach((item, index) => {
    if (item.kind === "tool" || item.kind === "tool_output") {
      if (pending.length === 0) start = index;
      pending.push(item);
    } else {
      flush();
      groups.push({ kind: "item", index, item });
    }
  });
  flush();
  return groups;
}
