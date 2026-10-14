/**
 * Electron main process: desktop lifecycle and the privileged IPC boundary.
 *
 * Main deliberately holds no application state. It
 * 1. forks the execution host utility process (which composes the app),
 * 2. opens the window,
 * 3. validates every renderer request before relaying it to the host,
 * 4. broadcasts host events to all windows, and
 * 5. shows native dialogs (the folder picker) on the renderer's behalf.
 *
 * Exit policy (default stop-on-exit from the architecture): quitting while
 * runs are active asks for confirmation, then asks the host to cancel them
 * and wait briefly for terminal states to be persisted before terminating
 * it. Closing the last window quits the app on every platform, because the
 * host must not keep working invisibly until background mode exists.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";

import {
  isHostCommand,
  validateCommandParams,
} from "../../contracts/desktop/commands.js";
import type { HostEvent } from "../../contracts/desktop/events.js";
import { ATTACHMENT_KINDS, IPC_CHANNELS, type AttachmentKind, type CommandResponse, type OpenPathResult } from "../../contracts/desktop/transport.js";
import { ContractValidationError, object, oneOf, optional, text } from "../../contracts/desktop/validation.js";
import { HostProcess } from "./host-process.js";
import { classifyOpenPath } from "./open-path.js";
import { createMainWindow } from "./window.js";

/** How long quitting waits for cancelled runs to record a terminal state. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const bundleDirectory = dirname(fileURLToPath(import.meta.url));
const paths = {
  host: join(bundleDirectory, "host.mjs"),
  preload: join(bundleDirectory, "preload.cjs"),
  index: join(bundleDirectory, "renderer", "index.html"),
};

let host: HostProcess | undefined;
let quitConfirmed = false;

function broadcast(event: HostEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.event, event);
  }
}

function openWindow(): void {
  createMainWindow({ preloadPath: paths.preload, indexPath: paths.index });
}

/**
 * Only the bundled page may call the bridge. This rejects requests from any
 * frame that somehow navigated elsewhere, even though navigation is blocked.
 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith("file://") && fileURLToPath(url) === paths.index;
}

async function handleInvoke(
  event: IpcMainInvokeEvent,
  command: unknown,
  params: unknown,
): Promise<CommandResponse> {
  if (!isTrustedSender(event)) {
    return { ok: false, error: { code: "invalid_input", name: "UntrustedSenderError", message: "Request rejected." } };
  }
  if (!isHostCommand(command)) {
    return { ok: false, error: { code: "unknown_command", name: "UnknownCommandError", message: `Unknown command '${String(command)}'.` } };
  }
  try {
    validateCommandParams(command, params);
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return { ok: false, error: { code: "invalid_input", name: error.name, message: error.message } };
    }
    throw error;
  }
  if (host === undefined) {
    return { ok: false, error: { code: "host_unavailable", name: "HostUnavailableError", message: "The execution host is not running." } };
  }
  await host.ready;
  return host.request(command, params);
}

const validateSelectDirectory = object({
  title: optional(text({ maxLength: 200 })),
  defaultPath: optional(text({ maxLength: 4096 })),
});

/**
 * Shows the native folder picker as a sheet/modal of the calling window.
 * Returns the chosen absolute path, or `undefined` on cancel or rejection.
 * Only a path string crosses back to the renderer; no filesystem access is
 * granted by this call.
 */
async function handleSelectDirectory(event: IpcMainInvokeEvent, options: unknown): Promise<string | undefined> {
  if (!isTrustedSender(event)) return undefined;
  let parsed: ReturnType<typeof validateSelectDirectory>;
  try {
    parsed = validateSelectDirectory(options ?? {}, "");
  } catch {
    return undefined;
  }
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Choose",
    ...(parsed.title === undefined ? {} : { title: parsed.title, message: parsed.title }),
    ...(parsed.defaultPath === undefined ? {} : { defaultPath: parsed.defaultPath }),
  };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = parent === null
    ? await dialog.showOpenDialog(dialogOptions)
    : await dialog.showOpenDialog(parent, dialogOptions);
  return result.canceled ? undefined : result.filePaths[0];
}

const validateOpenPath = object({
  path: text({ maxLength: 4096 }),
  base: optional(text({ maxLength: 4096 })),
});

const FILE_FILTERS: Record<AttachmentKind, Electron.FileFilter> = {
  images: { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic", "avif"] },
  documents: { name: "Documents", extensions: ["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "csv", "xls", "xlsx", "ppt", "pptx"] },
  code: { name: "Code and text", extensions: ["txt", "md", "json", "jsonl", "csv", "yaml", "yml", "toml", "xml", "log", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "swift", "kt", "html", "css", "sql", "sh", "ipynb"] },
  all: { name: "All files", extensions: ["*"] },
};

/** Selects regular files without exposing filesystem APIs or accepting arbitrary dialog options. */
async function handleSelectFiles(event: IpcMainInvokeEvent, kind: unknown): Promise<readonly string[]> {
  if (!isTrustedSender(event)) return [];
  const parsed = oneOf(ATTACHMENT_KINDS)(kind, "kind");
  const options: Electron.OpenDialogOptions = {
    title: "Attach files", buttonLabel: "Attach", properties: ["openFile", "multiSelections"],
    filters: parsed === "all" ? [FILE_FILTERS.all] : [FILE_FILTERS[parsed], FILE_FILTERS.all],
  };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
  return result.canceled ? [] : result.filePaths;
}

/**
 * Opens a path the user clicked (in a reply, tool activity, or diff).
 * Paths are untrusted text from agent output: `classifyOpenPath` resolves
 * them against the project folder and reveals anything that could execute
 * in Finder instead of opening it. Only the outcome crosses back.
 */
async function handleOpenPath(event: IpcMainInvokeEvent, request: unknown): Promise<OpenPathResult> {
  if (!isTrustedSender(event)) return "invalid";
  let parsed: ReturnType<typeof validateOpenPath>;
  try {
    parsed = validateOpenPath(request, "");
  } catch {
    return "invalid";
  }
  const action = await classifyOpenPath(parsed.path, parsed.base);
  if (action === undefined) return "invalid";
  if (action.kind === "missing") return "missing";
  if (action.kind === "reveal") {
    shell.showItemInFolder(action.path);
    return "revealed";
  }
  // openPath resolves with an error message, or "" on success.
  const failure = await shell.openPath(action.path);
  if (failure !== "") {
    shell.showItemInFolder(action.path);
    return "revealed";
  }
  return "opened";
}

/**
 * Confirms quitting when runs are active, then stops them through the host.
 * Returns false when the user chose to keep working.
 */
async function stopHostForQuit(current: HostProcess): Promise<boolean> {
  const active = await current.request("runs.active", {});
  const count = active.ok && Array.isArray(active.value) ? active.value.length : 0;
  if (count > 0) {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Stop runs and quit", "Keep working"],
      defaultId: 1,
      cancelId: 1,
      message: count === 1 ? "1 run is active." : `${count} runs are active.`,
      detail: "Quitting cancels active agent runs and waits briefly for them to record their final state. Partial output is kept.",
    });
    if (response !== 0) {
      return false;
    }
    await current.shutdown(SHUTDOWN_TIMEOUT_MS);
  }
  current.kill();
  return true;
}

app.on("before-quit", (event) => {
  if (quitConfirmed || host === undefined || !host.isRunning) {
    return;
  }
  event.preventDefault();
  const current = host;
  void stopHostForQuit(current).then((stopped) => {
    if (stopped) {
      quitConfirmed = true;
      app.quit();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      // The quit came from closing the last window; reopen it so the user
      // is not left with an invisible app that still owns active runs.
      openWindow();
    }
  });
});

app.on("window-all-closed", () => app.quit());

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    openWindow();
  }
});

void app.whenReady().then(() => {
  ipcMain.handle(IPC_CHANNELS.invoke, handleInvoke);
  ipcMain.handle(IPC_CHANNELS.selectDirectory, handleSelectDirectory);
  ipcMain.handle(IPC_CHANNELS.selectFiles, handleSelectFiles);
  ipcMain.handle(IPC_CHANNELS.openPath, handleOpenPath);
  // THINKING_AND_CODE_DATA_DIR isolates development or test data from the
  // default `~/.thinking-and-code` directory used by the host.
  const dataDirectory = process.env["THINKING_AND_CODE_DATA_DIR"];
  host = new HostProcess({
    modulePath: paths.host,
    args: dataDirectory === undefined || dataDirectory === "" ? [] : [`--data-directory=${dataDirectory}`],
    onEvent: broadcast,
    onExit: (code) => {
      broadcast({ type: "host.status", status: "exited", detail: `Execution host exited with code ${code}.` });
    },
  });
  void host.ready.then(() => broadcast({ type: "host.status", status: "ready" }));
  openWindow();
});
