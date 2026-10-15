/**
 * Creates the chat or standalone Timeline window with a locked-down renderer.
 *
 * Security posture, per the architecture's desktop boundary:
 * - `contextIsolation` and `sandbox` on, `nodeIntegration` off: the renderer
 *   gets only the `window.harness` bridge from the preload script;
 * - navigation away from the bundled page and new windows are refused, so
 *   remote content can never inherit the bridge;
 * - the page itself ships a strict Content-Security-Policy (see index.html).
 */
import { BrowserWindow, nativeTheme, shell } from "electron";
import type { TimelineWindowRequest } from "../../contracts/desktop/transport.js";

export interface MainWindowOptions {
  readonly preloadPath: string;
  readonly indexPath: string;
  /** A standalone historical viewer, with the same sandbox and fixed bundled page. */
  readonly timeline?: TimelineWindowRequest;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: options.timeline === undefined ? 980 : 800,
    minHeight: 600,
    // Matches the renderer's light/dark surface so the window does not flash
    // the wrong color before the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121417" : "#f5f5f3",
    title: options.timeline === undefined ? "Thinking and Code" : "Timeline snapshot",
    // macOS: content extends under an inset title bar; the sidebar reserves
    // space for the window controls and acts as the drag region.
    ...(process.platform === "darwin" && options.timeline === undefined ? { titleBarStyle: "hiddenInset" as const } : {}),
    show: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    // External web links open in the user's browser, never inside the app.
    // Other schemes (file:, javascript:, custom protocols) are refused.
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.once("ready-to-show", () => window.show());
  const target = options.timeline;
  void window.loadFile(options.indexPath, target === undefined ? {} : { query: {
    view: "timeline", scope: target.scope, contextId: target.contextId, checkpointId: target.checkpointId,
    ...(target.path === undefined ? {} : { path: target.path }),
  } });
  return window;
}
