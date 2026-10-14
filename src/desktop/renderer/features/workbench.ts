/**
 * Right panel: a launcher of surfaces ("Open a surface"), and the open
 * surface itself.
 *
 * - The launcher lists the core Changes surface and every plugin surface
 *   enabled in Settings > Plugins, each with its single-key shortcut. While
 *   the launcher is visible and focus is not in a text field, pressing a
 *   surface's key opens it.
 * - Changes reads the selected project working tree through the controller.
 *   Polls are serialized, bounded by the host adapter, and paused while hidden.
 *   Plugin surfaces remain previews. Stale replies cannot cross projects.
 *
 * The open surface is local presentation state. If its plugin is disabled
 * while open, the panel returns to the launcher.
 */
import type { ProjectChanges, ProjectRepositories, RepositoryDiscoveryOptions } from "../../../contracts/desktop/index.js";
import type { Controller } from "../controller.js";
import { diffFiles } from "./change-diff.js";
import { renderRunDetails } from "./run-detail.js";
import { h, replace } from "../dom.js";
import { icon } from "../icons.js";
import type { Store } from "../store.js";
import { SURFACES, type SurfaceDefinition } from "../surfaces.js";

export function mountWorkbench(root: HTMLElement, store: Store, isVisible: () => boolean, controller: Controller): void {
  let openSurface: string | undefined = "changes";
  let projectId: string | undefined;
  let repositories: ProjectRepositories | undefined;
  // Empty selection means All repositories; undefined means discovery pending.
  let repository: string | undefined;
  let generation = 0;
  let discoveryOptions: RepositoryDiscoveryOptions = {};
  const snapshots = new Map<string, { snapshot?: ProjectChanges; error?: string }>();
  let error: string | undefined;
  let inFlight = false;
  const collapsed = new Set<string>();
  const body = h("div", { class: "workbench-body" });
  root.append(body);

  const available = (): readonly SurfaceDefinition[] => {
    const enabled = new Set(store.get().enabledPlugins);
    return SURFACES.filter((surface) => surface.kind === "core" || enabled.has(surface.id));
  };

  const open = (surfaceId: string | undefined) => {
    openSurface = surfaceId;
    render();
    void refresh();
    if (surfaceId === "run-details") {
      const run = selectedRun();
      if (run !== undefined && run.id !== store.get().selection.runId) void controller.selectRun(run.id);
    }
  };

  function render(): void {
    const surfaces = available();
    const surface = surfaces.find((candidate) => candidate.id === openSurface);
    if (surface === undefined) {
      openSurface = undefined;
      replace(body, renderLauncher(surfaces, open));
    } else {
      replace(body, renderSurface(surface, () => open(undefined), surface.id === "changes" ? renderChanges()
        : surface.id === "run-details" ? renderDetails() : undefined));
    }
  }

  function sessionRuns() {
    const state = store.get();
    const runs = new Map(state.runs.map((run) => [run.id, run]));
    for (const live of Object.values(state.live)) {
      if (live.run.sessionId === state.selection.sessionId) runs.set(live.run.id, live.run);
    }
    return [...runs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  function selectedRun() {
    const runs = sessionRuns();
    return runs.find((run) => run.id === store.get().selection.runId) ?? runs[0];
  }

  /** Diagnostics move to the side panel, keeping the chat footer quiet. */
  function renderDetails(): HTMLElement {
    const run = selectedRun();
    return h("div", { class: "changes-content" }, run === undefined ? h("p", { class: "note" }, "No runs in this session yet.")
      : h("div", {}, h("select", { aria: { label: "Run details for" }, onChange: (event) => void controller.selectRun((event.target as HTMLSelectElement).value) },
        ...sessionRuns().map((candidate) => h("option", { value: candidate.id, selected: run.id === candidate.id }, `${candidate.prompt.slice(0, 60)} · ${candidate.status}`))),
        renderRunDetails(run, store.get(), controller)));
  }

  function saveSelection(): void {
    if (projectId === undefined || repository === undefined) return;
    try { localStorage.setItem(`changes.repository.${projectId}`, repository); } catch { /* Optional local preference. */ }
  }

  function chooseRepository(value: string): void {
    repository = value;
    generation++;
    snapshots.clear();
    collapsed.clear();
    saveSelection();
    render();
    void refresh();
  }

  function rescan(options: RepositoryDiscoveryOptions = {}): void {
    discoveryOptions = { deep: discoveryOptions.deep === true, ...options, rescan: true };
    repositories = undefined;
    repository = undefined;
    snapshots.clear();
    error = undefined;
    generation++;
    render();
    void refresh();
  }

  async function chooseFolder(): Promise<void> {
    const selected = projectId;
    const project = store.get().projects.find((candidate) => candidate.id === selected);
    const path = await controller.selectDirectory("Choose a repository folder inside this workspace", project?.path);
    if (path !== undefined && selected === projectId) rescan({ repositoryPath: path });
  }

  /** Serialize reads and invalidate replies on either workspace or repository changes. */
  async function refresh(): Promise<void> {
    const state = store.get();
    const selected = state.selection.projectId;
    if (inFlight || openSurface !== "changes" || !isVisible() || state.host.status !== "ready" || selected === undefined) return;
    inFlight = true;
    const version = generation;
    const current = () => generation === version && store.get().selection.projectId === selected;
    try {
      if (repositories === undefined) {
        let found = await controller.discoverProjectRepositories(selected, discoveryOptions);
        if (!current()) return;
        let saved: string | null = null;
        try { saved = localStorage.getItem(`changes.repository.${selected}`); } catch { /* Use discovery order. */ }
        // Manually selected/deep repositories may not be in the shallow scan
        // after restarting. Revalidate that preference through the host.
        if (found.selectedPath === undefined && saved && !found.paths.includes(saved)) {
          try { found = await controller.discoverProjectRepositories(selected, { repositoryPath: saved }); }
          catch { found = { ...found, warnings: [...found.warnings, "The previous repository is unavailable. Choose another repository."] }; }
          if (!current()) return;
        }
        repositories = found;
        repository = found.selectedPath ?? (saved === "" ? "" : saved && found.paths.includes(saved) ? saved : found.paths[0]);
        discoveryOptions = { deep: discoveryOptions.deep === true };
        error = undefined;
        saveSelection();
        render();
      }
      const paths = repository === "" ? repositories.paths : repository === undefined ? [] : [repository];
      // A failed repository does not hide successful siblings in All repositories.
      for (const path of paths) {
        let result: { snapshot?: ProjectChanges; error?: string };
        try { result = { snapshot: await controller.getProjectChanges(selected, path) }; }
        catch (failure) { result = { error: failure instanceof Error ? failure.message : String(failure) }; }
        if (!current()) return;
        if (JSON.stringify(snapshots.get(path)) !== JSON.stringify(result)) {
          snapshots.set(path, result);
          render();
        }
      }
    } catch (failure) {
      if (!current()) return;
      error = failure instanceof Error ? failure.message : String(failure);
      render();
    } finally {
      inFlight = false;
      // A picker change during an old read should start immediately, not wait
      // for the next polling tick. Never run concurrent Git reads for this view.
      if (!current()) void refresh();
    }
  }

  function renderChanges(): HTMLElement {
    const project = store.get().projects.find((candidate) => candidate.id === projectId);
    const paths = repository === "" ? repositories?.paths ?? [] : repository === undefined ? [] : [repository];
    return h("div", { class: "changes-content" },
      h("div", { class: "changes-heading" },
        h("span", { class: "note", title: project?.path ?? "" }, project?.path ?? "Select a project"),
        h("button", { class: "icon-button", type: "button", title: "Refresh changes", aria: { label: "Refresh changes" }, onClick: () => void refresh() }, icon("arrow-clockwise"))),
      projectId === undefined ? null : h("div", { class: "repository-controls" },
        repositories?.paths.length ? h("select", { aria: { label: "Repository" }, onChange: (event) => chooseRepository((event.target as HTMLSelectElement).value) },
          h("option", { value: "", selected: repository === "" }, "All repositories"),
          ...repositories.paths.map((path) => h("option", { value: path, selected: path === repository }, path === "." ? "Workspace repository" : path))) : null,
        h("div", { class: "repository-actions" },
          h("button", { class: "meta-link", type: "button", onClick: () => rescan() }, "Rescan"),
          h("button", { class: "meta-link", type: "button", onClick: () => rescan({ deep: true }) }, "Scan deeper"),
          h("button", { class: "meta-link", type: "button", onClick: () => void chooseFolder() }, "Choose folder"))),
      h("p", { class: "changes-note" }, "Current changes, including pre-existing edits. Repository selection only changes this view."),
      error !== undefined ? h("p", { class: "error-line" }, error)
        : projectId === undefined ? h("p", { class: "note" }, "Open a session to see its project changes.")
        : repositories === undefined ? h("p", { class: "note" }, "Finding repositories…")
        : repositories.paths.length === 0 ? h("p", { class: "note" }, "No repositories found. Scan deeper or choose a folder inside this workspace.") : null,
      repositories?.limited ? h("p", { class: "note" }, "Discovery reached its scan limit. Scan deeper or choose a repository folder.") : null,
      ...(repositories?.warnings ?? []).map((warning) => h("p", { class: "note" }, warning)),
      ...paths.map((path) => renderRepository(path)),
    );
  }

  function renderRepository(path: string): HTMLElement {
    const result = snapshots.get(path);
    const snapshot = result?.snapshot;
    const files = diffFiles(snapshot?.diff ?? "");
    return h("section", { class: "repository-changes", aria: { label: path } },
      h("h3", { class: "repository-title" }, path === "." ? "Workspace repository" : path),
      result?.error ? h("p", { class: "error-line" }, result.error)
        : snapshot === undefined ? h("p", { class: "note" }, "Loading changes…")
        : snapshot.status !== "ready" ? h("p", { class: "note" }, "Repository unavailable. Rescan or choose another folder.")
        : files.length === 0 ? h("p", { class: "note" }, "No changes in this repository.") : null,
      snapshot?.truncated ? h("p", { class: "note" }, "Large changes were shortened for this preview.") : null,
      ...files.map((file, index) => {
        const key = `${projectId}:${path}:${file.title}:${index}`;
        const panel = h("details", { class: "change-file", open: !collapsed.has(key) },
          h("summary", {}, icon("caret-right", { className: "activity-caret" }), h("span", { class: "change-path", title: file.title }, file.title),
            h("span", { class: "change-count diff-add" }, `+${file.added}`), h("span", { class: "change-count diff-remove" }, `−${file.removed}`)),
          h("pre", { class: "change-patch" }, h("code", {}, ...file.lines.map((line) => h("span", {
            class: line.startsWith("@@") || /^(diff --git|---|\+\+\+|index |new file|deleted file)/.test(line) ? "diff-header" : line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-remove" : "diff-context",
          }, line || " ")))));
        panel.addEventListener("toggle", () => {
          if (!panel.isConnected) return;
          if (panel.open) collapsed.delete(key); else collapsed.add(key);
        });
        return panel;
      }),
    );
  }

  // Poll current filesystem changes even when a tool produces no native diff.
  // Refresh also follows project selection and run start/finish, independently
  // of chat deltas, so streaming text never starts a Git process per token.
  const interval = window.setInterval(() => void refresh(), 2000);
  window.addEventListener("beforeunload", () => window.clearInterval(interval), { once: true });
  store.watch((state) => [state.selection.projectId, state.host.status, state.runs, Object.keys(state.live).join("|")], () => {
    const selected = store.get().selection.projectId;
    if (selected !== projectId) {
      projectId = selected;
      repositories = undefined;
      repository = undefined;
      discoveryOptions = {};
      generation++;
      snapshots.clear();
      error = undefined;
      collapsed.clear();
      render();
    }
    void refresh();
  });

  // Single-key shortcuts while the launcher is showing.
  document.addEventListener("keydown", (event) => {
    if (openSurface !== undefined || !isVisible() || event.metaKey || event.ctrlKey || event.altKey) return;
    if (store.get().settings.open || isTextInput(event.target)) return;
    const match = available().find((surface) => surface.shortcut.toLowerCase() === event.key.toLowerCase());
    if (match !== undefined) {
      event.preventDefault();
      open(match.id);
    }
  });

  store.watch((state) => state.enabledPlugins, () => render());
  store.watch((state) => [state.selection.runId, state.journal, state.live, state.runs, state.session], () => {
    if (openSurface === "run-details") render();
  });
}

function renderLauncher(surfaces: readonly SurfaceDefinition[], open: (id: string) => void): HTMLElement {
  return h("div", { class: "launcher" },
    h("p", { class: "launcher-title" }, "Open a surface"),
    h("div", { class: "launcher-list" },
      ...surfaces.map((surface) => h("button", {
        class: "launcher-item",
        title: surface.description,
        onClick: () => open(surface.id),
      },
        icon(surface.icon),
        h("span", { class: "launcher-label" }, surface.title),
        h("kbd", { class: "key-hint" }, surface.shortcut),
      )),
    ),
    h("p", { class: "launcher-note" }, "Enable more surfaces in Settings > Plugins."),
  );
}

function renderSurface(surface: SurfaceDefinition, back: () => void, content?: HTMLElement): HTMLElement {
  return h("div", { class: "surface" },
    h("div", { class: "surface-header" },
      h("button", { class: "icon-button", title: "All surfaces", aria: { label: "All surfaces" }, onClick: back }, icon("arrow-left")),
      icon(surface.icon),
      h("span", { class: "surface-title" }, surface.title),
      surface.kind === "plugin" ? h("span", { class: "soon" }, "Preview") : null,
    ),
    content ?? h("div", { class: "placeholder" },
      h("span", { class: "placeholder-icon" }, icon(surface.icon)),
      h("p", { class: "placeholder-title" }, surface.kind === "core" ? "No changes yet" : `${surface.title} is not available yet`),
      h("p", { class: "placeholder-text" }, surface.kind === "core"
        ? "Code changes and diffs from runs will appear here."
        : `${surface.description} This plugin is a preview with no functionality yet.`),
    ),
  );
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}
