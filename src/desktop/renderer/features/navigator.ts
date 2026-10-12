/**
 * Sidebar navigator.
 *
 * Upper part: a sessions tree. Each project is a folder that expands to its
 * sessions, most recently updated first. A session with an active run shows
 * a spinning icon; that is the only running indicator in the sidebar. The
 * folder's plus button opens an inline new-session form under that folder.
 *
 * Lower part: workspaces of the current project (the project of the open
 * session, or the folder last selected), with path, kind, starting revision,
 * and the active writer when one holds the lock, as the UI specification
 * requires before a run starts.
 *
 * Forms are static DOM nodes that are moved, not rebuilt, when the tree
 * re-renders, so typing is never interrupted. Which folders are expanded is
 * a per-device convenience kept in localStorage.
 */
import type { WorkspaceView } from "../../../contracts/desktop/index.js";
import { createDropdown } from "../components/dropdown.js";
import { openModal } from "../components/modal.js";
import type { Controller } from "../controller.js";
import { control, formatTime, h, inputField, label, readField, relativeTime, replace, shortId } from "../dom.js";
import { icon } from "../icons.js";
import type { AppState, Store } from "../store.js";

const EXPANDED_KEY = "sidebar.expandedProjects";

export function mountNavigator(root: HTMLElement, store: Store, controller: Controller): void {
  const expanded = loadExpanded();
  /** Project whose inline new-session form is open, if any. */
  let sessionFormProject: string | undefined;

  // --- New project ---------------------------------------------------------
  // The folder-plus button opens the native folder picker first; choosing a
  // folder opens a small dialog pre-filled from it. Cancelling the picker
  // does nothing.
  async function startNewProject(): Promise<void> {
    const rootPath = await controller.selectDirectory("Choose project folder");
    if (rootPath !== undefined) openProjectDialog(rootPath);
  }

  function openProjectDialog(initialPath: string): void {
    const name = h("input", { type: "text", name: "name", value: basename(initialPath) });
    name.required = true;
    const path = h("input", { type: "text", name: "rootPath", value: initialPath });
    path.required = true;
    const rootWorkspace = h("input", { type: "checkbox", checked: true });
    const browse = h("button", { class: "button", type: "button", onClick: () => {
      void controller.selectDirectory("Choose project folder", path.value || undefined).then((chosen) => {
        if (chosen === undefined) return;
        // Follow the folder name unless the user already typed their own.
        if (name.value === "" || name.value === basename(path.value)) name.value = basename(chosen);
        path.value = chosen;
      });
    } }, icon("folder-open"), "Browse");

    const form = h("form", { class: "modal-body", onSubmit: (event) => {
      event.preventDefault();
      const projectName = name.value.trim();
      const rootPath = path.value.trim();
      if (projectName === "" || rootPath === "") return;
      void controller.createProject(projectName, rootPath, rootWorkspace.checked).then((ok) => ok && modal.close());
    } },
      h("label", { class: "input" }, h("span", { class: "label" }, "Folder"),
        h("div", { class: "input-with-button" }, path, browse)),
      h("label", { class: "input" }, h("span", { class: "label" }, "Name"), name),
      h("label", { class: "checkbox" }, rootWorkspace, h("span", {}, "Add a shared workspace at this folder")),
      h("div", { class: "modal-actions" },
        h("button", { class: "button", type: "button", onClick: () => modal.close() }, "Cancel"),
        h("button", { class: "button button-primary", type: "submit" }, "Create project"),
      ),
    );
    const modal = openModal({ title: "New project", content: form });
    name.focus();
    name.select();
  }

  // --- New session form (moved under the target folder) ---------------------
  const sessionWorkspace = createDropdown<string>({ ariaLabel: "Workspace", placeholder: "Choose workspace", onChange: () => undefined });
  const sessionEmpty = h("p", { class: "form-note" }, "This project has no workspace yet. Add one in the workspaces section below.");
  const sessionForm = h("form", { class: "inline-form inline-form-nested", onSubmit: (event) => {
    event.preventDefault();
    const projectId = sessionFormProject;
    const workspaceId = sessionWorkspace.value;
    if (projectId === undefined || workspaceId === undefined) return;
    void controller.createSession(projectId, workspaceId, readField(sessionForm, "title")).then((ok) => {
      if (ok) closeSessionForm();
    });
  } },
    control("Workspace", sessionWorkspace.element),
    sessionEmpty,
    inputField("Title", "title", { placeholder: "optional" }),
    formActions("Start", () => closeSessionForm()),
  );

  async function openSessionForm(projectId: string): Promise<void> {
    sessionFormProject = projectId;
    expanded.add(projectId);
    saveExpanded(expanded);
    sessionForm.reset();
    const workspaces = await controller.listWorkspaces(projectId);
    sessionWorkspace.setOptions(workspaces.map(workspaceOption), workspaces[0]?.id);
    sessionWorkspace.setDisabled(workspaces.length === 0);
    sessionEmpty.hidden = workspaces.length > 0;
    if (workspaces.length === 0) void controller.selectProject(projectId);
    renderTree(store.get());
    sessionForm.querySelector<HTMLInputElement>("input[name=title]")?.focus();
  }

  function closeSessionForm(): void {
    sessionFormProject = undefined;
    sessionForm.remove();
  }

  // --- Workspace form -------------------------------------------------------
  const kind = createDropdown<"shared" | "isolated">({ ariaLabel: "Workspace kind", onChange: () => undefined });
  kind.setOptions([
    { value: "shared", label: "Shared", description: "Sequential handoffs; one writer at a time", icon: "folder-simple" },
    { value: "isolated", label: "Isolated", description: "Independent parallel work", icon: "git-branch" },
  ], "shared");
  const workspacePath = h("input", { type: "text", name: "path", placeholder: "/path/to/checkout" });
  workspacePath.required = true;
  const workspaceForm = h("form", { class: "inline-form", onSubmit: (event) => {
    event.preventDefault();
    const path = readField(workspaceForm, "path");
    const startingRevision = readField(workspaceForm, "startingRevision");
    if (path === undefined) return;
    void controller.createWorkspace({
      path,
      kind: kind.value ?? "shared",
      ...(startingRevision === undefined ? {} : { startingRevision }),
    }).then((ok) => ok && toggle(workspaceForm, false));
  } },
    h("label", { class: "input" }, h("span", { class: "label" }, "Path"),
      h("div", { class: "input-with-button" }, workspacePath,
        h("button", { class: "button", type: "button", title: "Browse", onClick: () => {
          const project = store.get().projects.find((candidate) => candidate.id === store.get().selection.projectId);
          void controller.selectDirectory("Choose workspace folder", workspacePath.value || project?.rootPath).then((chosen) => {
            if (chosen !== undefined) workspacePath.value = chosen;
          });
        } }, icon("folder-open")))),
    control("Kind", kind.element),
    inputField("Starting revision", "startingRevision", { placeholder: "optional" }),
    formActions("Add workspace", () => toggle(workspaceForm, false)),
  );
  toggle(workspaceForm, false);

  // --- Layout ---------------------------------------------------------------
  const tree = h("div", { class: "tree" });
  const workspaceTitle = h("span", { class: "label" });
  const workspaceList = h("div", { class: "nav-list" });
  const addWorkspace = iconButton("plus", "Add workspace", () => toggle(workspaceForm));

  root.append(
    h("div", { class: "sidebar-sessions" },
      h("div", { class: "nav-heading" },
        label("Projects"),
        iconButton("folder-simple-plus", "New project", () => void startNewProject()),
      ),
      tree,
    ),
    h("div", { class: "sidebar-workspaces" },
      h("div", { class: "nav-heading" }, workspaceTitle, addWorkspace),
      workspaceForm,
      workspaceList,
    ),
    h("div", { class: "sidebar-footer" },
      h("button", { class: "nav-item", onClick: () => controller.openSettings() },
        icon("gear-six", { className: "nav-icon" }),
        h("span", { class: "nav-title" }, "Settings"),
      ),
    ),
  );

  // --- Rendering ------------------------------------------------------------
  function renderTree(state: AppState): void {
    const running = new Set(runningKey(state).split("|"));
    if (state.projects.length === 0) {
      replace(tree, h("button", { class: "empty-card empty-action", onClick: () => void startNewProject() },
        icon("folder-simple-plus"), h("span", {}, "Add a project folder")));
      return;
    }
    replace(tree, ...state.projects.map((project) => {
      const sessions = state.sessions.filter((session) => session.projectId === project.id);
      const isOpen = expanded.has(project.id);
      const hasRunning = sessions.some((session) => running.has(session.id));
      const current = state.selection.projectId === project.id;
      const group = h("div", { class: "tree-group" },
        h("div", { class: current ? "tree-folder current" : "tree-folder" },
          h("button", {
            class: "tree-folder-toggle",
            aria: { expanded: String(isOpen) },
            title: project.rootPath,
            onClick: () => {
              if (isOpen) expanded.delete(project.id);
              else expanded.add(project.id);
              saveExpanded(expanded);
              // Toggling a folder never closes the open session.
              renderTree(store.get());
            },
          },
            icon("caret-right", { className: isOpen ? "tree-caret open" : "tree-caret" }),
            icon(isOpen ? "folder-open" : "folder-simple", { className: "nav-icon" }),
            h("span", { class: "nav-title" }, project.name),
            // A collapsed folder still signals that one of its sessions is running.
            !isOpen && hasRunning
              ? icon("circle-notch", { className: "tree-count spin", label: "Agent running" })
              : h("span", { class: "tree-count" }, String(sessions.length)),
          ),
          iconButton("plus", `New session in ${project.name}`, () => void openSessionForm(project.id), "tree-add"),
        ),
      );
      if (isOpen) {
        const children = h("div", { class: "tree-children" },
          ...sessions.map((session) => {
            const isRunning = running.has(session.id);
            return h("button", {
              class: session.id === state.selection.sessionId ? "tree-item active" : "tree-item",
              onClick: () => void controller.selectSession(session.id),
              title: `${session.title ?? "Session"} / updated ${formatTime(session.updatedAt)}`,
            },
              icon(isRunning ? "circle-notch" : "chat-circle-text", {
                className: isRunning ? "nav-icon spin" : "nav-icon",
                ...(isRunning ? { label: "Agent running" } : {}),
              }),
              h("span", { class: "nav-title" }, session.title ?? `Session ${shortId(session.id)}`),
              h("span", { class: "nav-age" }, relativeTime(session.updatedAt)),
            );
          }),
          sessions.length === 0 && sessionFormProject !== project.id
            ? h("p", { class: "empty tree-empty" }, "No sessions")
            : null,
        );
        if (sessionFormProject === project.id) children.prepend(sessionForm);
        group.append(children);
      }
      return group;
    }));
  }

  function renderWorkspaces(state: AppState): void {
    const project = state.projects.find((candidate) => candidate.id === state.selection.projectId);
    replace(workspaceTitle, project === undefined ? "Workspaces" : `Workspaces / ${project.name}`);
    addWorkspace.disabled = project === undefined;
    replace(workspaceList, ...(project === undefined
      ? [h("p", { class: "empty" }, "Select a project folder.")]
      : state.workspaces.length === 0
        ? [h("p", { class: "empty" }, "No workspaces.")]
        : state.workspaces.map((workspace) => h("div", {
          class: "workspace-item",
          title: [
            workspace.path,
            workspace.kind,
            workspace.startingRevision === undefined ? undefined : `rev ${workspace.startingRevision}`,
            workspace.activeWriterAttemptId === undefined ? undefined : `writer ${shortId(workspace.activeWriterAttemptId)}`,
          ].filter((part) => part !== undefined).join(" / "),
        },
          icon(workspace.kind === "isolated" ? "git-branch" : "folder-simple", { className: "nav-icon" }),
          h("span", { class: "nav-title mono" }, basename(workspace.path)),
          workspace.activeWriterAttemptId === undefined
            ? h("span", { class: "nav-age" }, [workspace.kind, workspace.startingRevision?.slice(0, 7)].filter(Boolean).join(" "))
            : icon("pencil-simple", { label: "Being edited", className: "nav-trailing" }),
        ))));
  }

  // The running set is selected as a string key so streaming events (which
  // replace `state.live` on every delta) do not redraw the tree.
  store.watch(
    (state) => [state.projects, state.sessions, state.selection.sessionId, state.selection.projectId, runningKey(state)],
    (_slice, state) => {
      // Reveal the folder of the open session.
      const projectId = state.selection.projectId;
      if (state.selection.sessionId !== undefined && projectId !== undefined && !expanded.has(projectId)) {
        expanded.add(projectId);
        saveExpanded(expanded);
      }
      renderTree(state);
    },
  );
  store.watch((state) => [state.workspaces, state.selection.projectId, state.projects], (_slice, state) => renderWorkspaces(state));
}

function workspaceOption(workspace: WorkspaceView) {
  return {
    value: workspace.id,
    label: basename(workspace.path),
    description: `${workspace.kind} / ${workspace.path}`,
    icon: workspace.kind === "isolated" ? "git-branch" as const : "folder-simple" as const,
  };
}

/** Sorted, `|`-joined IDs of sessions with at least one run active in the host. */
function runningKey(state: AppState): string {
  return [...new Set(Object.values(state.live).map((live) => live.run.sessionId))].sort().join("|");
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}

function iconButton(name: Parameters<typeof icon>[0], title: string, onClick: () => void, extraClass = ""): HTMLButtonElement {
  return h("button", { class: `icon-button ${extraClass}`.trim(), type: "button", title, aria: { label: title }, onClick }, icon(name));
}

function formActions(submitText: string, onCancel: () => void): HTMLElement {
  return h("div", { class: "form-actions" },
    h("button", { class: "button", type: "button", onClick: onCancel }, "Cancel"),
    h("button", { class: "button button-primary", type: "submit" }, submitText),
  );
}

/** Shows or hides an inline form; with no `open` argument it toggles. */
function toggle(form: HTMLFormElement, open?: boolean): void {
  const show = open ?? form.hidden;
  form.hidden = !show;
  if (show) form.querySelector("input")?.focus();
  else form.reset();
}

function loadExpanded(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: ReadonlySet<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  } catch {
    // Expansion state is a convenience; losing it is harmless.
  }
}
