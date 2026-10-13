/**
 * Application frame and window chrome.
 *
 * Regions: left sidebar (wordmark and navigator), main column (toolbar,
 * notice banner, session, composer), right workbench, and the overlay root
 * for settings.
 *
 * Both sidebars are retractable with toggle buttons in the main toolbar;
 * the collapsed state is a per-device preference. A collapsed left sidebar
 * can be "peeked": moving the pointer to the window's left edge slides it in
 * over the content, and it slides away when the pointer leaves, unless focus
 * or an open menu is still inside it. The right sidebar has no hover reveal.
 *
 * Host connectivity problems surface in the notice banner; there is no
 * "online" indicator light. The stored theme is applied before anything
 * renders so the first paint uses the right palette.
 */
import type { Controller } from "../controller.js";
import { h, replace } from "../dom.js";
import { icon } from "../icons.js";
import type { Store } from "../store.js";
import { applyTheme, loadTheme } from "../theme.js";

export interface ShellRegions {
  readonly navigator: HTMLElement;
  /** Slot in the toolbar for the session title and metadata. */
  readonly sessionHeader: HTMLElement;
  readonly session: HTMLElement;
  readonly composer: HTMLElement;
  readonly workbench: HTMLElement;
  readonly overlay: HTMLElement;
  /** Whether the right panel is currently shown. */
  readonly isWorkbenchVisible: () => boolean;
}

const LAYOUT_KEY = "layout.collapsed";
/** Delay before a peeked sidebar hides, so brief pointer exits do not flicker it. */
const PEEK_HIDE_DELAY_MS = 220;

export function mountShell(root: HTMLElement, store: Store, controller: Controller): ShellRegions {
  applyTheme(loadTheme());
  // macOS uses an inset title bar; the toolbar leaves room for the window
  // controls when the left sidebar is collapsed.
  if (navigator.userAgent.includes("Macintosh")) {
    document.documentElement.classList.add("platform-mac");
  }

  const layout = loadLayout();
  const sidebar = h("aside", { class: "sidebar" });
  const workbench = h("aside", { class: "workbench" });
  const regions: ShellRegions = {
    navigator: h("div", { class: "sidebar-body" }),
    sessionHeader: h("div", { class: "toolbar-title" }),
    session: h("div", { class: "session" }),
    composer: h("div", { class: "composer-region" }),
    workbench,
    overlay: h("div", { class: "overlay-root" }),
    isWorkbenchVisible: () => !layout.right,
  };

  const leftToggle = toggleButton("Toggle sidebar", "sidebar-simple", () => setCollapsed("left", !layout.left));
  const rightToggle = toggleButton("Toggle right panel", "sidebar-simple", () => setCollapsed("right", !layout.right), "mirrored");
  const notice = h("div", { class: "notice", aria: { live: "polite" } });
  const hoverZone = h("div", { class: "peek-zone", aria: { hidden: "true" } });

  sidebar.append(
    h("div", { class: "sidebar-top" }, h("span", { class: "wordmark" }, "thinking & code")),
    regions.navigator,
  );
  root.append(
    sidebar,
    h("main", { class: "main" },
      h("header", { class: "toolbar" }, leftToggle, regions.sessionHeader, rightToggle),
      notice,
      regions.session,
      regions.composer,
    ),
    workbench,
    hoverZone,
    regions.overlay,
  );
  workbench.append(h("div", { class: "workbench-top" }));

  // --- Collapse and peek ------------------------------------------------------
  let hideTimer: number | undefined;
  const peek = (show: boolean) => {
    window.clearTimeout(hideTimer);
    if (show) {
      sidebar.classList.add("peek");
      return;
    }
    hideTimer = window.setTimeout(() => {
      // Keep the sidebar while the user is typing in it or using one of its menus.
      const menuOpen = document.querySelector(".popover") !== null;
      if (sidebar.contains(document.activeElement) || menuOpen) return;
      sidebar.classList.remove("peek");
    }, PEEK_HIDE_DELAY_MS);
  };
  hoverZone.addEventListener("pointerenter", () => peek(true));
  sidebar.addEventListener("pointerenter", () => layout.left && peek(true));
  sidebar.addEventListener("pointerleave", () => layout.left && peek(false));
  sidebar.addEventListener("focusout", () => layout.left && peek(false));

  function setCollapsed(side: "left" | "right", collapsed: boolean): void {
    layout[side] = collapsed;
    saveLayout(layout);
    applyLayout();
  }

  function applyLayout(): void {
    root.classList.toggle("left-collapsed", layout.left);
    root.classList.toggle("right-collapsed", layout.right);
    sidebar.classList.remove("peek");
    leftToggle.setAttribute("aria-pressed", String(!layout.left));
    rightToggle.setAttribute("aria-pressed", String(!layout.right));
  }
  applyLayout();

  // --- Notice banner ----------------------------------------------------------
  store.watch((state) => [state.notice, state.host], (_slice, state) => {
    const offline = state.host.status === "exited"
      ? { kind: "error" as const, message: state.host.detail ?? "The execution host stopped. Restart the app to reconnect." }
      : undefined;
    const current = state.notice ?? offline;
    notice.hidden = current === undefined;
    if (current === undefined) {
      notice.replaceChildren();
      return;
    }
    notice.className = `notice notice-${current.kind}`;
    const action = state.notice?.action;
    replace(notice,
      icon(current.kind === "error" ? "warning-circle" : "info"),
      h("span", { class: "notice-text" }, current.message),
      state.notice?.code === undefined ? null : h("span", { class: "notice-code" }, state.notice.code),
      action === undefined ? null : h("button", { class: "button button-small", onClick: () => {
        controller.dismissNotice();
        action.run();
      } }, icon("arrow-clockwise"), action.label),
      state.notice === undefined ? null : h("button", {
        class: "icon-button",
        title: "Dismiss",
        aria: { label: "Dismiss" },
        onClick: () => controller.dismissNotice(),
      }, icon("x")),
    );
  });

  return regions;
}

function toggleButton(label: string, iconName: Parameters<typeof icon>[0], onClick: () => void, extraClass = ""): HTMLButtonElement {
  return h("button", { class: `icon-button toolbar-toggle ${extraClass}`.trim(), title: label, aria: { label }, onClick }, icon(iconName));
}

function loadLayout(): { left: boolean; right: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as { left?: unknown; right?: unknown };
    return { left: stored.left === true, right: stored.right === true };
  } catch {
    return { left: false, right: false };
  }
}

function saveLayout(layout: { left: boolean; right: boolean }): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Layout is a convenience; losing it restores both sidebars.
  }
}
