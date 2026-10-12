import assert from "node:assert/strict";
import test from "node:test";

import { parseInline, parseMarkdown } from "./markdown.js";

test("paragraphs, headings, lists, quotes, and fenced code are recognized", () => {
  const blocks = parseMarkdown([
    "## Plan",
    "",
    "First line",
    "continues here.",
    "",
    "- one",
    "- two",
    "",
    "1. alpha",
    "2. beta",
    "",
    "> quoted",
    "",
    "```ts",
    "const x = 1;",
    "```",
  ].join("\n"));
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "list", "list", "quote", "code"]);
  assert.deepEqual(blocks[5], { type: "code", language: "ts", text: "const x = 1;" });
  assert.equal(blocks[2]?.type === "list" && blocks[2].ordered, false);
  assert.equal(blocks[3]?.type === "list" && blocks[3].ordered, true);
});

test("an unterminated fence while streaming keeps the rest as code", () => {
  const blocks = parseMarkdown("Before\n```\npartial line");
  assert.deepEqual(blocks.at(-1), { type: "code", text: "partial line" });
});

test("inline code, bold, italic, and http links parse; other markers stay literal", () => {
  assert.deepEqual(parseInline("push `dev` to **origin**"), [
    { type: "text", text: "push " },
    { type: "code", text: "dev" },
    { type: "text", text: " to " },
    { type: "strong", children: [{ type: "text", text: "origin" }] },
  ]);
  assert.deepEqual(parseInline("see [docs](https://example.com/a)"), [
    { type: "text", text: "see " },
    { type: "link", href: "https://example.com/a", children: [{ type: "text", text: "docs" }] },
  ]);
  // Non-http links and snake_case identifiers are not treated as markup.
  assert.deepEqual(parseInline("[x](javascript:alert(1)) my_var_name 2 * 3"), [
    { type: "text", text: "[x](javascript:alert(1)) my_var_name 2 * 3" },
  ]);
});
