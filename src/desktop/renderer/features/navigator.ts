/**
 * Unified workspace navigator.
 *
 * A workspace is the only selectable folder entity in the desktop. Sessions
 * attach directly to it, and there is no project grouping in the UI or core.
 *
 * Adding a workspace uses the native folder picker, and a session is created
 * directly from a workspace row. There are deliberately no editable
 * setup fields here: paths and names come from the folder the user chooses.
 */
import type { WorkspaceView } from "../../../contracts/desktop/index.js";
import type { Controller } from "../controller.js";
import { h, label, replace, relativeTime, shortId } from "../dom.js";
import { icon } from "../icons.js";
import type { AppState, Store } from "../store.js";

const EXPANDED_KEY = "sidebar.expandedWorkspaces";

export function mountNavigator(root: HTMLElement, store: Store, controller: Controller): void {
  const expanded = loadExpanded();

  async function addWorkspace(): Promise<void> {
    const path = await controller.selectDirectory("Choose workspace folder");
    if (path === undefined) return;

    await controller.createWorkspace({ path, kind: "shared" });
  }

  const tree = h("div", { class: "tree" });
  const add = iconButton("folder-simple-plus", "Add workspace", () => void addWorkspace());

  root.append(
    h("div", { class: "sidebar-sessions sidebar-workspaces-unified" },
      h("div", { class: "nav-heading" }, label("Workspaces"), add),
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
    if (state.workspaces.length === 0) {
      replace(tree, h("button", { class: "empty-card empty-action", onClick: () => void addWorkspace() },
        icon("folder-simple-plus"), h("span", {}, "Add a workspace folder")));
      return;
    }

    replace(tree, ...state.workspaces.map((workspace) => renderWorkspace(workspace, state, running)));
  }

  function renderWorkspace(workspace: WorkspaceView, state: AppState, running: Set<string>): HTMLElement {
    const sessions = state.sessions.filter((session) => session.workspaceId === workspace.id);
    const isOpen = expanded.has(workspace.id);
    const hasRunning = sessions.some((session) => running.has(session.id));
    const group = h("div", { class: "tree-group" });
    const folder = h("div", { class: "tree-folder workspace-folder" },
      h("button", {
        class: "tree-folder-toggle",
        aria: { expanded: String(isOpen) },
        title: workspace.path,
        onClick: () => {
          if (isOpen) expanded.delete(workspace.id);
          else expanded.add(workspace.id);
          saveExpanded(expanded);
          renderTree(store.get());
        },
      },
        icon("caret-right", { className: isOpen ? "tree-caret open" : "tree-caret" }),
        icon(workspace.kind === "isolated" ? "git-branch" : "folder-open", { className: "nav-icon" }),
        h("span", { class: "nav-text" },
          h("span", { class: "nav-title" }, basename(workspace.path)),
          h("span", { class: "nav-meta" }, [workspace.kind, workspace.startingRevision?.slice(0, 7)].filter(Boolean).join(" · ")),
        ),
        !isOpen && hasRunning
          ? icon("circle-notch", { className: "tree-count spin", label: "Agent running" })
          : h("span", { class: "tree-count" }, String(sessions.length)),
      ),
      iconButton("plus", `New session in ${basename(workspace.path)}`, () => {
        void controller.createSessionForWorkspace(workspace.id);
      }, "tree-add"),
    );
    group.append(folder);

    if (isOpen) {
      const children = h("div", { class: "tree-children" },
        ...sessions.map((session) => {
          const isRunning = running.has(session.id);
          return h("button", {
            class: session.id === state.selection.sessionId ? "tree-item active" : "tree-item",
            onClick: () => void controller.selectSession(session.id),
            title: `${session.title ?? "Session"} / updated ${session.updatedAt}`,
          },
            icon(isRunning ? "circle-notch" : "chat-circle-text", {
              className: isRunning ? "nav-icon spin" : "nav-icon",
              ...(isRunning ? { label: "Agent running" } : {}),
            }),
            h("span", { class: "nav-title" }, session.title ?? `Session ${shortId(session.id)}`),
            h("span", { class: "nav-age" }, relativeTime(session.updatedAt)),
          );
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
    (state) => [state.workspaces, state.sessions, state.selection.sessionId, runningKey(state)],
    (_slice, state) => {
      const selectedSession = state.sessions.find((session) => session.id === state.selection.sessionId);
      if (selectedSession !== undefined && !expanded.has(selectedSession.workspaceId)) {
        expanded.add(selectedSession.workspaceId);
        saveExpanded(expanded);
      }
      renderTree(state);
    },
  );
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
    const raw = localStorage.getItem(EXPANDED_KEY);
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
