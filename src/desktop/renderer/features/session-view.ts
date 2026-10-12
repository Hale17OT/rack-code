/**
 * Center column: the selected session's conversation, rendered per run.
 *
 * Each run block shows its prompt, a label row (runtime, provider, account,
 * model, permission mode, attempt, status), and its output:
 * - active runs render the live event fold (streaming text, tools,
 *   approvals) from the host snapshot plus live events;
 * - finished runs render the persisted assistant message for that run, or
 *   the run result/error when no message was saved.
 *
 * Tool details of finished runs are available from the journal in the run
 * detail panel rather than re-folded here, which keeps session loading cheap.
 */
import type {
  AccountView,
  ApprovalRequest,
  RunView,
  SessionView,
  WorkspaceView,
} from "../../../contracts/desktop/index.js";
import type { Controller } from "../controller.js";
import { dataView, h, replace, row, shortId } from "../dom.js";
import { icon } from "../icons.js";
import type { AppState, LiveRun, Store } from "../store.js";
import { foldEvents, type TranscriptItem, type TranscriptState } from "../transcript.js";
import { renderRunDetails } from "./run-detail.js";
import { accountLabel, isActiveStatus, PERMISSION_LABELS, runBadge, runtimeOf } from "./run-format.js";

/**
 * Mounts the transcript into `root` and the session title/metadata into
 * `header`, a slot the shell places in the main toolbar.
 */
export function mountSessionView(root: HTMLElement, header: HTMLElement, store: Store, controller: Controller): void {
  const transcript = h("div", { class: "transcript" });
  root.append(transcript);

  // Folding is memoized per events array: unchanged live runs are not re-folded.
  const folds = new WeakMap<readonly unknown[], TranscriptState>();
  const fold = (live: LiveRun): TranscriptState => {
    let state = folds.get(live.events);
    if (state === undefined) {
      state = foldEvents(live.events);
      folds.set(live.events, state);
    }
    return state;
  };

  store.watch((state) => [state.session, state.workspaces, state.selection.sessionId], (_slice, state) => {
    replace(header, ...renderHeader(state.session, state.workspaces));
  });

  store.watch(
    (state) => [state.session, state.runs, state.live, state.accounts, state.selection.runId, state.journal, state.workspaces, state.runtimes, state.acknowledgedUnknown],
    (_slice, state) => {
      // Keep following streamed output only when the user is already at the bottom.
      const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48;
      replace(transcript, ...renderTranscript(state, controller, fold));
      if (atBottom) transcript.scrollTop = transcript.scrollHeight;
    },
  );
}

function renderHeader(session: SessionView | undefined, workspaces: readonly WorkspaceView[]): Node[] {
  if (session === undefined) {
    return [h("span", { class: "session-title muted" }, "No session")];
  }
  const workspace = workspaces.find((candidate) => candidate.id === session.workspaceId);
  const meta = [
    workspace?.path ?? shortId(session.workspaceId),
    workspace?.kind,
    workspace?.startingRevision?.slice(0, 7),
  ].filter((part) => part !== undefined).join(" / ");
  return [
    h("span", { class: "session-title" }, session.title ?? `Session ${shortId(session.id)}`),
    h("span", { class: "session-meta", title: meta }, meta),
    h("div", { class: "session-chips" },
      workspace?.activeWriterAttemptId === undefined ? null : h("span", { class: "chip" },
        icon("pencil-simple"), `writer ${shortId(workspace.activeWriterAttemptId)}`),
      // Native IDs are diagnostic continuation metadata only.
      ...session.continuations.map((continuation) => h("span", { class: "chip", title: continuation.nativeSessionId },
        icon("plugs"), `${continuation.runtimeId} ${shortId(continuation.nativeSessionId)}`)),
    ),
  ];
}

function renderTranscript(
  state: AppState,
  controller: Controller,
  fold: (live: LiveRun) => TranscriptState,
): Node[] {
  const session = state.session;
  if (session === undefined || state.selection.sessionId === undefined) {
    return [placeholder("chat-circle-text", "No session selected", "Create a project, a workspace, and a session from the sidebar.")];
  }

  // Live runs of this session that the persisted list does not contain yet.
  const liveOnly = Object.values(state.live)
    .map((live) => live.run)
    .filter((run) => run.sessionId === session.id && !state.runs.some((stored) => stored.id === run.id));
  const runs = [...state.runs, ...liveOnly];
  const runIds = new Set(runs.map((run) => run.id));

  // Messages not linked to any run (none are produced today) are shown first.
  const orphanMessages = session.messages
    .filter((message) => message.metadata?.["runId"] === undefined || !runIds.has(message.metadata["runId"]))
    .map((message) => h("div", { class: `message message-${message.role}` },
      h("span", { class: "label" }, message.role),
      h("div", { class: "assistant-text" }, message.content),
    ));

  if (runs.length === 0 && orphanMessages.length === 0) {
    return [placeholder("terminal-window", "Ready", "Write a prompt below to start the first run.")];
  }

  return [
    ...orphanMessages,
    ...runs.map((run, index) => renderRun(run, index + 1, state, controller, fold)),
  ];
}

function renderRun(
  stored: RunView,
  ordinal: number,
  state: AppState,
  controller: Controller,
  fold: (live: LiveRun) => TranscriptState,
): HTMLElement {
  const live = state.live[stored.id];
  const run = live?.run ?? stored;
  const account = state.accounts.find((candidate) => candidate.id === run.accountId);
  const selected = state.selection.runId === run.id;

  const body: Node[] = [];
  if (live !== undefined) {
    const folded = fold(live);
    body.push(...folded.items.map((item) => renderItem(item, run, account, live, controller)));
    if (folded.failure !== undefined) body.push(errorBlock(folded.failure.error));
    if (folded.items.length === 0) {
      body.push(h("div", { class: "run-waiting" },
        icon("circle-notch", { className: "spin" }),
        run.status === "queued" ? "Waiting for workspace and runtime" : "Working"));
    }
  } else {
    const assistant = state.session?.messages.find((message) =>
      message.role === "assistant" && message.metadata?.["runId"] === run.id);
    const text = assistant?.content ?? run.result;
    if (text !== undefined) body.push(h("div", { class: "assistant-text" }, text));
    if (run.error !== undefined) body.push(errorBlock(run.error));
  }

  const cancellable = live !== undefined && isActiveStatus(run.status);
  return h("article", { class: selected ? "run selected" : "run", data: { runId: run.id } },
    h("button", {
      class: "run-header",
      title: selected ? "Hide run details" : "Show run details",
      aria: { expanded: String(selected) },
      onClick: () => void controller.selectRun(run.id),
    },
      h("span", { class: "run-ordinal" }, String(ordinal).padStart(2, "0")),
      runBadge(run.status),
      h("span", { class: "run-labels" },
        [runtimeOf(run), accountLabel(account, run.accountId), run.model ?? "default model",
          PERMISSION_LABELS[run.permissionMode].label].join(" / ")),
      icon("caret-right", { className: selected ? "run-caret open" : "run-caret" }),
    ),
    h("div", { class: "prompt" }, run.prompt),
    live?.fallbackFromAccountId === undefined ? null : h("div", { class: "run-note" },
      icon("info"),
      `Selected account ${accountLabel(state.accounts.find((candidate) => candidate.id === live.fallbackFromAccountId), live.fallbackFromAccountId)} was unavailable; using ${accountLabel(account, run.accountId)}.`),
    body.length === 0 ? null : h("div", { class: "run-body" }, ...body),
    selected ? renderRunDetails(run, state, controller) : null,
    !cancellable ? null : h("div", { class: "run-actions" },
      h("button", {
        class: "button",
        disabled: live.cancelRequested,
        onClick: () => void controller.cancelRun(run.id),
      }, icon("stop-circle"), live.cancelRequested ? "Cancelling" : "Cancel"),
    ),
  );
}

function renderItem(
  item: TranscriptItem,
  run: RunView,
  account: AccountView | undefined,
  live: LiveRun,
  controller: Controller,
): Node {
  switch (item.kind) {
    case "text":
      return h("div", { class: "assistant-text" }, item.text);
    case "tool":
      return h("div", { class: "tool" },
        h("div", { class: "tool-row" },
          h("span", { class: "icon-tile" }, icon("terminal-window")),
          h("span", { class: "tool-text" },
            h("span", { class: "tool-name" }, item.tool),
            h("span", { class: "tool-meta" }, item.hasOutput ? "completed" : "in progress"),
          ),
          item.hasOutput ? icon("check", { className: "tool-state" }) : icon("circle-notch", { className: "tool-state spin" }),
        ),
        dataView("Input", item.input),
        item.hasOutput ? dataView("Output", item.output) : null,
      );
    case "tool_output":
      return h("div", { class: "tool" }, dataView("Result", item.output));
    case "approval":
      return renderApproval(item.request, run, account, live, controller);
    case "status":
      return h("div", { class: "run-note" }, icon("info"), item.label, item.detail === undefined ? null : `: ${item.detail}`);
  }
}

/**
 * Approval card. Shows everything the spec lists (request ID, tool, input,
 * reason, runtime/provider, account, workspace, run/attempt) and answers
 * with the exact request ID.
 */
function renderApproval(
  request: ApprovalRequest,
  run: RunView,
  account: AccountView | undefined,
  live: LiveRun,
  controller: Controller,
): HTMLElement {
  const pending = live.pendingApprovals.some((candidate) => candidate.id === request.id);
  const decision = live.decisions[request.id];
  return h("div", { class: pending ? "approval pending" : "approval" },
    h("div", { class: "approval-head" },
      h("span", { class: "icon-tile" }, icon(pending ? "hand" : decision === "deny" ? "prohibit" : "shield-check")),
      h("span", { class: "tool-text" },
        h("span", { class: "tool-name" }, pending ? "Approval required" : decision === undefined ? "Approval resolved" : `Approval ${decision === "allow" ? "allowed" : "denied"}`),
        h("span", { class: "tool-meta" }, `${request.tool} / ${shortId(request.id)}`),
      ),
    ),
    request.reason === undefined ? null : h("p", { class: "approval-reason" }, request.reason),
    h("div", { class: "detail-rows" },
      row("Tool", request.tool),
      row("Runtime / provider", `${runtimeOf(run)} / ${run.providerId}`),
      row("Account", accountLabel(account, run.accountId)),
      row("Workspace", shortId(run.workspaceId)),
      row("Run / attempt", `${shortId(run.id)} / ${shortId(run.attempts.at(-1)?.id)}`),
    ),
    dataView("Input", request.input),
    !pending ? null : h("div", { class: "approval-actions" },
      h("button", { class: "button", onClick: () => void controller.respondToApproval(run.id, request.id, "deny") }, icon("x"), "Deny"),
      h("button", { class: "button button-primary", onClick: () => void controller.respondToApproval(run.id, request.id, "allow") }, icon("check"), "Allow"),
    ),
  );
}

function errorBlock(text: string): HTMLElement {
  return h("div", { class: "run-error" }, icon("warning-circle"), h("span", {}, text));
}

function placeholder(iconName: Parameters<typeof icon>[0], title: string, text: string): HTMLElement {
  return h("div", { class: "placeholder" },
    h("span", { class: "placeholder-icon" }, icon(iconName)),
    h("p", { class: "placeholder-title" }, title),
    h("p", { class: "placeholder-text" }, text),
  );
}
