/**
 * Unified project navigator.
 *
 * A project is the only selectable folder entity in the desktop. Sessions
 * attach directly to it in both the UI and the application model.
 *
 * Adding a project uses the native folder picker, and a session is created
 * directly from a project row. There are deliberately no editable
 * setup fields here: paths and names come from the folder the user chooses.
 */
import type { ProjectView } from "../../../contracts/desktop/index.js";
import type { Controller } from "../controller.js";
import { h, label, replace, relativeTime, shortId } from "../dom.js";
import { icon } from "../icons.js";
import type { AppState, Store } from "../store.js";
import { openSessionImport } from "./session-import.js";
import { moveRow, orderedIds } from "./sidebar-order.js";

const EXPANDED_KEY = "sidebar.expandedProjects";

export function mountNavigator(root: HTMLElement, store: Store, controller: Controller): void {
  const expanded = loadExpanded();
  // Ordering is a desktop preference, separate from folder identity and run state.
  const orders = new Map<string, string[]>();
  let dragged: { scope: string; id: string } | undefined;
  function order(scope: string, ids: string[]): string[] {
    if (!orders.has(scope)) {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(`sidebar.order.${scope}`) ?? "[]");
        orders.set(scope, Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []);
      } catch { orders.set(scope, []); }
    }
    return orderedIds(ids, orders.get(scope)!);
  }
  function reorder(scope: string, ids: string[], source: string, target: string, after: boolean): void {
    const next = moveRow(ids, source, target, after);
    orders.set(scope, next);
    try { localStorage.setItem(`sidebar.order.${scope}`, JSON.stringify(next)); } catch { /* Navigation still works without saved preferences. */ }
    renderTree(store.get());
  }
  /** Native dragging is scoped to siblings; Alt+arrows provides keyboard ordering. */
  function draggable(row: HTMLElement, scope: string, id: string, ids: string[]): void {
    row.draggable = true;
    row.dataset.reorderId = id;
    row.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      dragged = { scope, id };
      event.dataTransfer?.setData("text/plain", id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      dragged = undefined;
      tree.querySelectorAll(".drop-before, .drop-after, .dragging").forEach((node) => node.classList.remove("drop-before", "drop-after", "dragging"));
    });
    row.addEventListener("dragover", (event) => {
      if (dragged?.scope !== scope || dragged.id === id) return;
      event.preventDefault();
      const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.classList.toggle("drop-after", after);
      row.classList.toggle("drop-before", !after);
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
    row.addEventListener("drop", (event) => {
      if (dragged?.scope !== scope) return;
      event.preventDefault();
      const source = dragged.id;
      dragged = undefined;
      reorder(scope, ids, source, id, event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2);
    });
    row.addEventListener("keydown", (event) => {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      const down = event.key === "ArrowDown";
      const target = ids[ids.indexOf(id) + (down ? 1 : -1)];
      if (target === undefined) return;
      event.preventDefault();
      reorder(scope, ids, id, target, down);
      const moved = [...tree.querySelectorAll<HTMLElement>("[data-reorder-id]")].find((node) => node.dataset.reorderId === id);
      (moved?.querySelector<HTMLElement>("button") ?? moved)?.focus();
    });
  }

  async function addProject(): Promise<void> {
    const path = await controller.selectDirectory("Choose project folder");
    if (path === undefined) return;

    await controller.createProject({ path });
  }

  const tree = h("div", { class: "tree" });
  const add = iconButton("folder-simple-plus", "Add project", () => void addProject());

  root.append(
    h("div", { class: "sidebar-sessions sidebar-projects-unified" },
      h("div", { class: "nav-heading" }, label("Projects"), add),
      tree,
    ),
    h("div", { class: "sidebar-footer" },
      h("button", { class: "nav-item", onClick: () => controller.openSettings() },
        icon("gear-six", { className: "nav-icon" }),
        h("span", { class: "nav-title" }, "Settings"),
      ),
    ),
  );

  function renderTree(state: AppState): void {
    const running = new Set(runningKey(state).split("|"));
    const waiting = new Set(waitingKey(state).split("|"));
    if (state.projects.length === 0) {
      replace(tree, h("button", { class: "empty-card empty-action", onClick: () => void addProject() },
        icon("folder-simple-plus"), h("span", {}, "Add a project folder")));
      return;
    }

    const ids = order("projects", state.projects.map((project) => project.id));
    replace(tree, ...ids.map((id) => renderProject(state.projects.find((project) => project.id === id)!, state, running, waiting)));
  }

  /**
   * Session activity indicators, strongest first: a pending approval (the
   * agent is blocked on the user) outranks a running agent. Approvals are
   * flagged on every session, including ones not currently open, so a
   * request raised in the background is visible from the sidebar.
   */
  function renderProject(project: ProjectView, state: AppState, running: Set<string>, waiting: Set<string>): HTMLElement {
    const siblings = state.sessions.filter((session) => session.projectId === project.id);
    const sessionIds = order(`sessions.${project.id}`, siblings.map((session) => session.id));
    const sessions = sessionIds.map((id) => siblings.find((session) => session.id === id)!);
    const isOpen = expanded.has(project.id);
    const hasRunning = sessions.some((session) => running.has(session.id));
    const hasWaiting = sessions.some((session) => waiting.has(session.id));
    const group = h("div", { class: "tree-group" });
    const folder = h("div", { class: "tree-folder project-folder" },
      h("button", {
        class: "tree-folder-toggle",
        aria: { expanded: String(isOpen) },
        title: project.path,
        onClick: () => {
          if (isOpen) expanded.delete(project.id);
          else expanded.add(project.id);
          saveExpanded(expanded);
          renderTree(store.get());
        },
      },
        icon("caret-right", { className: isOpen ? "tree-caret open" : "tree-caret" }),
        icon("folder-open", { className: "nav-icon" }),
        h("span", { class: "nav-text" },
          h("span", { class: "nav-title" }, basename(project.path)),
          project.startingRevision === undefined ? null : h("span", { class: "nav-meta" }, project.startingRevision.slice(0, 7)),
        ),
        // A collapsed folder summarizes its hidden sessions in place of the count.
        !isOpen && hasWaiting
          ? icon("hand", { className: "tree-count needs-approval", label: "A session needs your approval" })
          : !isOpen && hasRunning
            ? icon("circle-notch", { className: "tree-count spin", label: "Agent running" })
            : h("span", { class: "tree-count" }, String(sessions.length)),
      ),
      iconButton("database", `Import local sessions into ${basename(project.path)}`, () => openSessionImport(project, controller), "tree-add"),
      iconButton("plus", `New session in ${basename(project.path)}`, () => {
        void controller.createSessionForProject(project.id);
      }, "tree-add"),
    );
    group.append(folder);
    draggable(folder, "projects", project.id, order("projects", state.projects.map((candidate) => candidate.id)));

    if (isOpen) {
      const children = h("div", { class: "tree-children" },
        ...sessions.map((session) => {
          const isRunning = running.has(session.id);
          const isWaiting = waiting.has(session.id);
          const row = h("button", {
            class: [session.id === state.selection.sessionId ? "tree-item active" : "tree-item", isWaiting ? "needs-approval" : ""].join(" ").trim(),
            onClick: () => void controller.selectSession(session.id),
            title: isWaiting
              ? `${session.title ?? "Session"} / waiting for your approval`
              : `${session.title ?? "Session"} / updated ${session.updatedAt}`,
          },
            isWaiting
              ? icon("hand", { className: "nav-icon", label: "Waiting for your approval" })
              : icon(isRunning ? "circle-notch" : "chat-circle-text", {
                className: isRunning ? "nav-icon spin" : "nav-icon",
                ...(isRunning ? { label: "Agent running" } : {}),
              }),
            h("span", { class: "nav-title" }, session.title ?? `Session ${shortId(session.id)}`),
            // Status is an icon plus a word: the age gives way to the request.
            isWaiting
              ? h("span", { class: "nav-age approval-flag" }, "Needs approval")
              : h("span", { class: "nav-age" }, relativeTime(session.updatedAt)),
          );
          draggable(row, `sessions.${project.id}`, session.id, sessionIds);
          return row;
        }),
        sessions.length === 0
          ? h("p", { class: "empty tree-empty" }, "No sessions yet. Use + to start one.")
          : null,
      );
      group.append(children);
    }
    return group;
  }

  store.watch(
    (state) => [state.projects, state.sessions, state.selection.sessionId, runningKey(state), waitingKey(state)],
    (_slice, state) => {
      const selectedSession = state.sessions.find((session) => session.id === state.selection.sessionId);
      if (selectedSession !== undefined && !expanded.has(selectedSession.projectId)) {
        expanded.add(selectedSession.projectId);
        saveExpanded(expanded);
      }
      renderTree(state);
    },
  );
}

/**
 * Sorted IDs of sessions with at least one approval pending in the host.
 * Pending approvals live on host-owned active runs, so this survives
 * renderer reloads and reflects answers given from any client.
 */
function waitingKey(state: AppState): string {
  return [...new Set(Object.values(state.live)
    .filter((live) => live.pendingApprovals.length > 0)
    .map((live) => live.run.sessionId))].sort().join("|");
}

/** Sorted IDs of sessions with at least one active host run. */
function runningKey(state: AppState): string {
  return [...new Set(Object.values(state.live).map((live) => live.run.sessionId))].sort().join("|");
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}

function iconButton(name: Parameters<typeof icon>[0], title: string, onClick: () => void, extraClass = ""): HTMLButtonElement {
  return h("button", {
    class: `icon-button ${extraClass}`.trim(),
    type: "button",
    title,
    aria: { label: title },
    onClick,
  }, icon(name));
}

function loadExpanded(): Set<string> {
  try {
    // Keep the expansion preference when upgrading the workspace-named UI;
    // migrated projects retain the IDs used by those older rows.
    const raw = localStorage.getItem(EXPANDED_KEY) ?? localStorage.getItem("sidebar.expandedWorkspaces");
    const values: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(values: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...values]));
  } catch {
    // Local preferences are optional; a restricted storage context should not
    // prevent navigation or session creation.
  }
}
