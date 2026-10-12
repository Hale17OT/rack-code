/**
 * Minimal Markdown support for assistant messages.
 *
 * `parseMarkdown` is a pure function producing a small block/inline tree and
 * is unit tested without a DOM. `renderMarkdown` turns the tree into DOM
 * nodes using text nodes only, never `innerHTML`, so provider output cannot
 * inject markup. Links are rendered only for http(s) URLs and open through
 * the supplied callback (the default browser), never inside the app.
 *
 * Supported: paragraphs, ATX headings (#, ##, ###), fenced code blocks,
 * bullet and numbered lists, block quotes, inline code, bold, italic, and
 * links. Anything else renders as plain text, which is the safe fallback
 * for a streaming message that is only partly written.
 */

export type Inline =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "strong"; readonly children: readonly Inline[] }
  | { readonly type: "em"; readonly children: readonly Inline[] }
  | { readonly type: "link"; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly type: "paragraph"; readonly inlines: readonly Inline[] }
  | { readonly type: "heading"; readonly level: 1 | 2 | 3; readonly inlines: readonly Inline[] }
  | { readonly type: "code"; readonly language?: string; readonly text: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | { readonly type: "quote"; readonly inlines: readonly Inline[] };

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", inlines: parseInline(paragraph.join("\n")) });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;

    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence !== null) {
      flushParagraph();
      const body: string[] = [];
      index += 1;
      // An unterminated fence (still streaming) runs to the end of the text.
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] as string)) {
        body.push(lines[index] as string);
        index += 1;
      }
      blocks.push({ type: "code", ...(fence[1] ? { language: fence[1] } : {}), text: body.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading !== null) {
      flushParagraph();
      blocks.push({ type: "heading", level: (heading[1] as string).length as 1 | 2 | 3, inlines: parseInline(heading[2] as string) });
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item !== null && paragraph.length === 0) {
      const ordered = item[2] !== undefined;
      const items: Inline[][] = [];
      while (index < lines.length) {
        const current = (lines[index] as string).match(LIST_ITEM);
        if (current === null || (current[2] !== undefined) !== ordered) break;
        items.push(parseInline(current[3] as string));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] as string)) {
        quoted.push((lines[index] as string).replace(/^\s*>\s?/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "quote", inlines: parseInline(quoted.join("\n")) });
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/** Parses inline code, links, bold, and italic. Unmatched markers stay literal. */
export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer !== "") {
      result.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);

    const code = rest.match(/^`([^`]+)`/);
    if (code !== null) {
      flush();
      result.push({ type: "code", text: code[1] as string });
      index += code[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    if (link !== null) {
      flush();
      result.push({ type: "link", href: link[2] as string, children: parseInline(link[1] as string) });
      index += link[0].length;
      continue;
    }

    const strong = rest.match(/^\*\*(?=\S)([\s\S]*?\S)\*\*/) ?? rest.match(/^__(?=\S)([\s\S]*?\S)__/);
    if (strong !== null) {
      flush();
      result.push({ type: "strong", children: parseInline(strong[1] as string) });
      index += strong[0].length;
      continue;
    }

    const em = rest.match(/^\*(?=\S)([^*]*?\S)\*/) ?? rest.match(/^_(?=\S)([^_]*?\S)_(?![A-Za-z0-9])/);
    if (em !== null && !/[A-Za-z0-9]$/.test(buffer)) {
      flush();
      result.push({ type: "em", children: parseInline(em[1] as string) });
      index += em[0].length;
      continue;
    }

    buffer += text[index];
    index += 1;
  }
  flush();
  return result;
}

export function renderMarkdown(source: string, openLink: (href: string) => void): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(source)) {
    fragment.append(renderBlock(block, openLink));
  }
  return fragment;
}

function renderBlock(block: Block, openLink: (href: string) => void): HTMLElement {
  switch (block.type) {
    case "paragraph":
      return withInlines(document.createElement("p"), block.inlines, openLink);
    case "heading":
      return withInlines(document.createElement(`h${block.level + 2}` as "h3"), block.inlines, openLink);
    case "quote":
      return withInlines(document.createElement("blockquote"), block.inlines, openLink);
    case "code": {
      const pre = document.createElement("pre");
      pre.className = "md-code";
      if (block.language !== undefined) pre.dataset["language"] = block.language;
      const code = document.createElement("code");
      code.textContent = block.text;
      pre.append(code);
      return pre;
    }
    case "list": {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        list.append(withInlines(document.createElement("li"), item, openLink));
      }
      return list;
    }
  }
}

function withInlines<T extends HTMLElement>(element: T, inlines: readonly Inline[], openLink: (href: string) => void): T {
  for (const inline of inlines) {
    element.append(renderInline(inline, openLink));
  }
  return element;
}

function renderInline(inline: Inline, openLink: (href: string) => void): Node {
  switch (inline.type) {
    case "text":
      return document.createTextNode(inline.text);
    case "code": {
      const code = document.createElement("code");
      code.className = "md-inline-code";
      code.textContent = inline.text;
      return code;
    }
    case "strong":
      return withInlines(document.createElement("strong"), inline.children, openLink);
    case "em":
      return withInlines(document.createElement("em"), inline.children, openLink);
    case "link": {
      const anchor = document.createElement("a");
      anchor.href = inline.href;
      anchor.title = inline.href;
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        openLink(inline.href);
      });
      return withInlines(anchor, inline.children, openLink);
    }
  }
}
