/**
 * Center column: the open session as a simple chat transcript.
 *
 * Each run is one turn:
 * - the prompt is a right-aligned bubble; long prompts are clipped with a
 *   "Show full message" toggle;
 * - the reply is plain text in the page (no bubble), rendered as Markdown.
 *   Live and persisted event folds show streamed text, readable thinking
 *   panels, and formatted command/file activity cards. Completed turns keep
 *   their activity after reload; the saved assistant message is a fallback;
 * - pending approvals are not part of the transcript. The composer renders
 *   them in an overlay above the prompt (see `composer.ts`);
 * - the quiet footer shows only the date and time; active runs are stopped
 *   from the composer.
 *
 * Also renders the session title in the toolbar slot, a left-edge turn
 * navigator (one tick per turn, highlighting those in view), and a
 * "Scroll to end" pill when the view is not at the bottom.
 *
 * The transcript re-renders on every state change (batched per frame), so
 * presentation state that must survive a re-render (expanded prompts,
 * opened tool rows) lives in closure sets keyed by stable IDs.
 */
import type {
  RunView,
  SessionView,
  ProjectView,
  RuntimeEvent,
} from "../../../contracts/desktop/index.js";
import type { Controller } from "../controller.js";
import { formatTime, h, replace, shortId } from "../dom.js";
import { icon } from "../icons.js";
import { renderMarkdown } from "../markdown.js";
import type { AppState, Store } from "../store.js";
import { foldEvents, type TranscriptItem, type TranscriptState } from "../transcript.js";
import { accountLabel, isActiveStatus } from "./run-format.js";
import { importedTool, presentTool } from "./tool-presentation.js";

/** Prompts longer than this (characters or lines) start clipped. */
const LONG_PROMPT_CHARS = 600;
const LONG_PROMPT_LINES = 8;
/** Distance from the bottom, in pixels, that still counts as "at the end". */
const AT_END_THRESHOLD = 48;

interface ViewMemory {
  readonly expandedPrompts: Set<string>;
  readonly openTools: Set<string>;
  readonly collapsedThinking: Set<string>;
}

export function mountSessionView(root: HTMLElement, header: HTMLElement, store: Store, controller: Controller): void {
  const transcript = h("div", { class: "transcript" });
  const rail = h("nav", { class: "turn-rail", aria: { label: "Turns" } });
  const scrollToEnd = h("button", {
    class: "scroll-end",
    onClick: () => transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" }),
  }, icon("caret-down"), "Scroll to end");
  scrollToEnd.hidden = true;
  root.append(transcript, rail, scrollToEnd);

  const memory: ViewMemory = { expandedPrompts: new Set(), openTools: new Set(), collapsedThinking: new Set() };
  let current: AppState | undefined;
  const rerender = () => {
    if (current !== undefined) draw(current, false);
  };

  // Folding is memoized per events array: unchanged live runs are not re-folded.
  const folds = new WeakMap<readonly unknown[], TranscriptState>();
  const fold = (events: readonly RuntimeEvent[]): TranscriptState => {
    let state = folds.get(events);
    if (state === undefined) {
      state = foldEvents(events);
      folds.set(events, state);
    }
    return state;
  };

  const isAtEnd = () => transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < AT_END_THRESHOLD;
  const updateChrome = () => {
    scrollToEnd.hidden = isAtEnd();
    updateRail(rail, transcript);
  };
  transcript.addEventListener("scroll", updateChrome, { passive: true });

  function draw(state: AppState, jumpToEnd: boolean): void {
    // Keep following streamed output only when the user is already at the end.
    const follow = jumpToEnd || isAtEnd();
    const scrollTop = transcript.scrollTop;
    replace(transcript, ...renderTranscript(state, controller, fold, memory, rerender));
    transcript.scrollTop = follow ? transcript.scrollHeight : scrollTop;
    renderRail(rail, transcript);
    updateChrome();
  }

  store.watch((state) => [state.session, state.projects, state.selection.sessionId], (_slice, state) => {
    replace(header, ...renderHeader(state.session, state.projects));
  });

  let lastSessionId: string | undefined;
  store.watch(
    (state) => [state.session, state.runs, state.live, state.transcripts, state.accounts, state.selection.runId, state.journal, state.projects, state.runtimes, state.acknowledgedUnknown],
    (_slice, state) => {
      current = state;
      const sessionChanged = state.session?.id !== lastSessionId;
      lastSessionId = state.session?.id;
      draw(state, sessionChanged);
    },
  );
}

function renderHeader(session: SessionView | undefined, projects: readonly ProjectView[]): Node[] {
  if (session === undefined) {
    return [h("span", { class: "session-title muted" }, "No session")];
  }
  const project = projects.find((candidate) => candidate.id === session.projectId);
  const meta = [
    project?.path ?? shortId(session.projectId),
    project?.startingRevision?.slice(0, 7),
  ].filter((part) => part !== undefined).join(" / ");
  return [
    h("span", { class: "session-title" }, session.title ?? `Session ${shortId(session.id)}`),
    h("span", { class: "session-meta", title: meta }, meta),
    h("div", { class: "session-chips" },
      project?.activeWriterAttemptId === undefined ? null : h("span", { class: "chip" },
        icon("pencil-simple"), `writer ${shortId(project.activeWriterAttemptId)}`),
    ),
  ];
}

function renderTranscript(
  state: AppState,
  controller: Controller,
  fold: (events: readonly RuntimeEvent[]) => TranscriptState,
  memory: ViewMemory,
  rerender: () => void,
): Node[] {
  const session = state.session;
  if (session === undefined || state.selection.sessionId === undefined) {
    return [placeholder("chat-circle-text", "No session selected", "Add a project folder, then use its + button to start a session.")];
  }

  // Live runs of this session that the persisted list does not contain yet.
  const liveOnly = Object.values(state.live)
    .map((live) => live.run)
    .filter((run) => run.sessionId === session.id && !state.runs.some((stored) => stored.id === run.id));
  const runs = [...state.runs, ...liveOnly];
  const imported = session.messages.filter((message) => message.metadata?.["imported"] === "true");
  if (runs.length === 0 && imported.length === 0) {
    return [placeholder("terminal-window", "What should we work on?", "Describe a task below. The agent works in this session's project.")];
  }
  return [
    ...(session.importSource === undefined ? [] : [h("div", { class: "import-history-note note" }, icon("database"),
      `Imported from ${session.importSource.providerName}. Continuing uses recent conversation context in a new runtime session; the original remains unchanged.`)]),
    ...imported.map((message) => h("article", { class: "turn imported-turn", data: { importedMessageId: message.id } },
      message.role === "user" ? renderPrompt({ id: message.id, prompt: message.content }, memory, rerender)
        : message.role === "assistant" ? h("div", { class: "reply md" }, renderMarkdown(message.content, (href) => controller.openExternal(href)))
        : message.metadata?.["presentation"] === "thinking"
          ? thinkingLine(message.id, memory, message.content, message.metadata?.["thinkingFormat"] === "summary" ? "summary" : "trace", (href) => controller.openExternal(href))
          : activityLine(message.id, memory, importedTool(message.content), false),
    )),
    ...runs.map((run) => renderTurn(run, state, controller, fold, memory, rerender)),
  ];
}

function renderTurn(
  stored: RunView,
  state: AppState,
  controller: Controller,
  fold: (events: readonly RuntimeEvent[]) => TranscriptState,
  memory: ViewMemory,
  rerender: () => void,
): HTMLElement {
  const live = state.live[stored.id];
  const run = live?.run ?? stored;
  const account = state.accounts.find((candidate) => candidate.id === run.accountId);
  const openLink = (href: string) => controller.openExternal(href);

  const reply: Node[] = [];
  let copyText = "";
  const events = live?.events ?? state.transcripts[run.id];
  const folded = events === undefined ? undefined : fold(events);
  if (folded !== undefined) {
    for (const [index, item] of folded.items.entries()) {
      reply.push(renderItem(item, `${run.id}:${index}`, memory, openLink, live !== undefined && isActiveStatus(run.status)));
    }
    copyText = folded.items.flatMap((item) => item.kind === "text" ? [item.text] : []).join("\n\n");
    if (folded.failure !== undefined) reply.push(errorLine(folded.failure.error));
  }
  if (live !== undefined) {
    if (isActiveStatus(run.status) && (reply.length === 0 || live.cancelRequested)) {
      reply.push(h("div", { class: "note working" }, icon("circle-notch", { className: "spin" }),
        live.cancelRequested ? "Stopping" : run.status === "queued" ? "Waiting for the project" : "Working"));
    }
  } else {
    if (copyText === "") {
      const assistant = state.session?.messages.find((message) => message.role === "assistant" && message.metadata?.["runId"] === run.id);
      copyText = assistant?.content ?? run.result ?? "";
      if (copyText !== "") reply.push(h("div", { class: "md" }, renderMarkdown(copyText, openLink)));
    }
    if (run.error !== undefined && folded?.failure === undefined) reply.push(errorLine(run.error));
    if (run.status === "interrupted" && !folded?.items.some((item) => item.kind === "status" && item.label === "interrupted")) reply.push(h("div", { class: "note" }, icon("stop-circle"), "Stopped"));
    if (run.status === "unknown") reply.push(h("div", { class: "note" }, icon("question"), "Ended without a final result. Review the activity before continuing."));
  }
  if (live?.fallbackFromAccountId !== undefined) {
    const from = state.accounts.find((candidate) => candidate.id === live.fallbackFromAccountId);
    reply.unshift(h("div", { class: "note" }, icon("info"),
      `${accountLabel(from, live.fallbackFromAccountId)} was unavailable; using ${accountLabel(account, run.accountId)}.`));
  }

  const active = isActiveStatus(run.status);
  const meta = active ? h("div", { class: "run-progress", role: "status", aria: { label: live?.cancelRequested ? "Stopping" : "Run in progress" } },
    h("span", { class: "progress-dots", aria: { hidden: "true" } }, h("span"), h("span"), h("span")),
  ) : h("div", { class: "turn-meta" },
    h("time", { class: "meta-time", title: run.createdAt }, formatTime(run.createdAt)),
  );
  if (active) {
    // Streaming redraws rebuild the turn. Phase dots against the run timestamp
    // so their animation keeps advancing instead of restarting on each token.
    const elapsed = Math.max(0, Date.now() - Date.parse(run.createdAt)) || 0;
    meta.querySelectorAll<HTMLElement>(".progress-dots > span").forEach((dot, index) => {
      dot.style.animationDelay = `${-(elapsed % 1200) - (3 - index) * 150}ms`;
    });
  }

  return h("article", { class: "turn", data: { runId: run.id } },
    renderPrompt(run, memory, rerender),
    h("div", { class: "reply" }, ...reply, meta),
  );
}

function renderPrompt(run: Pick<RunView, "id" | "prompt">, memory: ViewMemory, rerender: () => void): HTMLElement {
  const long = run.prompt.length > LONG_PROMPT_CHARS || run.prompt.split("\n").length > LONG_PROMPT_LINES;
  const expanded = memory.expandedPrompts.has(run.id);
  return h("div", { class: "prompt-row" },
    h("div", { class: long && !expanded ? "bubble clipped" : "bubble" },
      h("div", { class: "bubble-text" }, run.prompt),
      !long ? null : h("button", {
        class: "bubble-toggle",
        onClick: () => {
          if (expanded) memory.expandedPrompts.delete(run.id);
          else memory.expandedPrompts.add(run.id);
          rerender();
        },
      }, expanded ? "Show less" : "Show full message"),
    ),
  );
}

function renderItem(
  item: TranscriptItem, key: string, memory: ViewMemory,
  openLink: (href: string) => void, active: boolean,
): Node {
  switch (item.kind) {
    case "text": return h("div", { class: "md" }, renderMarkdown(item.text, openLink));
    case "thinking": return thinkingLine(key, memory, item.text, item.format, openLink);
    case "tool": return activityLine(key, memory, item, active);
    case "tool_output": return activityLine(key, memory, {
      kind: "tool", tool: "Tool output", input: undefined, output: item.output, hasOutput: true, finished: true,
    }, false);
    case "status": return h("div", { class: "note" }, icon("info"), item.label, item.detail === undefined ? null : `: ${item.detail}`);
  }
}

/** Activity starts as a compact status row; details appear only on user expansion. */
function activityLine(key: string, memory: ViewMemory, item: Extract<TranscriptItem, { kind: "tool" }>, active: boolean): HTMLElement {
  const view = presentTool(item, active);
  const running = view.status === "Running";
  const details = h("details", { class: `activity-card${view.status === "Failed" ? " failed" : ""}`, open: memory.openTools.has(key) },
    h("summary", {},
      h("span", { class: "activity-icon" }, icon(view.icon)),
      h("span", { class: "activity-heading" },
        h("span", { class: "activity-title" }, view.title === "Run command"
          ? `${running ? "Running" : view.status === "Completed" ? "Ran" : view.status} command`
          : `${view.status} · ${view.title}`),
        view.subtitle === undefined ? null : h("code", { class: "activity-target", title: view.subtitle }, view.subtitle)),
      h("span", { class: "activity-meta" },
        view.duration === undefined ? null : h("span", {}, view.duration),
        view.exitCode === undefined ? null : h("span", {}, `exit ${view.exitCode}`),
        h("span", { class: "activity-status", title: view.status, aria: { label: view.status } }, icon(running ? "circle-notch" : view.status === "Failed" ? "x-circle" : view.status === "Stopped" ? "stop-circle" : view.status === "Completed" ? "check" : "question", { className: running ? "spin" : "" }))),
      icon("caret-right", { className: "activity-caret" })),
    h("div", { class: "activity-body" }, ...view.sections.map((section) => h("section", { class: "activity-section" },
      h("span", { class: "activity-section-label" }, section.label),
      section.format === "diff" ? h("pre", { class: "activity-diff" }, h("code", {}, ...section.text.split("\n").map((line) =>
        h("span", { class: /^(@@|---|\+\+\+)/.test(line) ? "diff-header" : line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-remove" : "diff-context" }, line || " "))))
        : h("pre", { class: `activity-code activity-${section.format}` }, section.text),
    ))),
  );
  details.addEventListener("toggle", () => {
    if (details.open) memory.openTools.add(key); else memory.openTools.delete(key);
  });
  return details;
}

/**
 * Exposed thinking text, shown directly with a lightbulb and no text label.
 *
 * The trace is open by default. The lightbulb is the only control: it
 * collapses the trace to a one-line preview and expands it again, and the
 * choice survives re-renders through `memory.collapsedThinking`. Summaries
 * and readable traces must stay distinguishable (architecture: runtime
 * activity presentation), so the kind is carried by the button's accessible
 * name and tooltip rather than a visible heading.
 */
function thinkingLine(key: string, memory: ViewMemory, text: string, format: "trace" | "summary" | undefined, openLink: (href: string) => void): HTMLElement {
  const kind = format === "summary" ? "Reasoning summary" : format === "trace" ? "Thinking trace" : "Thinking";
  const prose = h("div", { class: "thinking-prose md" }, renderMarkdown(text, openLink));
  const toggle = h("button", { class: "thinking-toggle", type: "button" }, icon("lightbulb"));
  const panel = h("div", { class: "thinking-panel", data: { format: format ?? "unknown" } }, toggle, prose);
  const sync = () => {
    const collapsed = memory.collapsedThinking.has(key);
    panel.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${kind.toLowerCase()}`);
    toggle.title = kind;
  };
  toggle.addEventListener("click", () => {
    if (memory.collapsedThinking.has(key)) memory.collapsedThinking.delete(key); else memory.collapsedThinking.add(key);
    sync();
  });
  sync();
  return panel;
}

function errorLine(text: string): HTMLElement {
  return h("div", { class: "error-line" }, icon("warning-circle"), h("span", {}, text));
}

function placeholder(iconName: Parameters<typeof icon>[0], title: string, text: string): HTMLElement {
  return h("div", { class: "placeholder" },
    h("span", { class: "placeholder-icon" }, icon(iconName)),
    h("p", { class: "placeholder-title" }, title),
    h("p", { class: "placeholder-text" }, text),
  );
}

/** One tick per turn; clicking a tick scrolls that turn into view. */
function renderRail(rail: HTMLElement, transcript: HTMLElement): void {
  const turns = [...transcript.querySelectorAll<HTMLElement>(".turn")];
  rail.hidden = turns.length < 2;
  replace(rail, ...turns.map((turn, index) => h("button", {
    class: "turn-tick",
    title: `Turn ${index + 1}`,
    aria: { label: `Go to turn ${index + 1}` },
    onClick: () => turn.scrollIntoView({ behavior: "smooth", block: "start" }),
  })));
}

/** Highlights the ticks of turns currently visible in the transcript. */
function updateRail(rail: HTMLElement, transcript: HTMLElement): void {
  const view = transcript.getBoundingClientRect();
  const turns = transcript.querySelectorAll<HTMLElement>(".turn");
  const ticks = rail.querySelectorAll<HTMLElement>(".turn-tick");
  turns.forEach((turn, index) => {
    const rect = turn.getBoundingClientRect();
    ticks[index]?.classList.toggle("visible", rect.bottom > view.top && rect.top < view.bottom);
  });
}
