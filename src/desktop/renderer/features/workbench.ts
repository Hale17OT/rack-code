/**
 * Right panel: a launcher of surfaces ("Open a surface"), and the open
 * surface itself.
 *
 * - The launcher lists the core Changes surface and every plugin surface
 *   enabled in Settings > Plugins, each with its single-key shortcut. While
 *   the launcher is visible and focus is not in a text field, pressing a
 *   surface's key opens it.
 * - An open surface shows a back button to the launcher. No surface has
 *   real content yet: Changes shows an empty state, and plugin surfaces say
 *   they are previews. This panel must not imply capabilities the host does
 *   not provide.
 *
 * The open surface is local presentation state. If its plugin is disabled
 * while open, the panel returns to the launcher.
 */
import { h, replace } from "../dom.js";
import { icon } from "../icons.js";
import type { Store } from "../store.js";
import { SURFACES, type SurfaceDefinition } from "../surfaces.js";

export function mountWorkbench(root: HTMLElement, store: Store, isVisible: () => boolean): void {
  let openSurface: string | undefined;
  const body = h("div", { class: "workbench-body" });
  root.append(body);

  const available = (): readonly SurfaceDefinition[] => {
    const enabled = new Set(store.get().enabledPlugins);
    return SURFACES.filter((surface) => surface.kind === "core" || enabled.has(surface.id));
  };

  const open = (surfaceId: string | undefined) => {
    openSurface = surfaceId;
    render();
  };

  function render(): void {
    const surfaces = available();
    const surface = surfaces.find((candidate) => candidate.id === openSurface);
    if (surface === undefined) {
      openSurface = undefined;
      replace(body, renderLauncher(surfaces, open));
    } else {
      replace(body, renderSurface(surface, () => open(undefined)));
    }
  }

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

function renderSurface(surface: SurfaceDefinition, back: () => void): HTMLElement {
  return h("div", { class: "surface" },
    h("div", { class: "surface-header" },
      h("button", { class: "icon-button", title: "All surfaces", aria: { label: "All surfaces" }, onClick: back }, icon("arrow-left")),
      icon(surface.icon),
      h("span", { class: "surface-title" }, surface.title),
      surface.kind === "plugin" ? h("span", { class: "soon" }, "Preview") : null,
    ),
    h("div", { class: "placeholder" },
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
