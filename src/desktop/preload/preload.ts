/**
 * Preload bridge: the renderer's only route to privileged operations.
 *
 * Exposes `window.harness` (`HarnessBridge`): host commands, host events,
 * and the native folder picker. It forwards arguments without interpreting
 * them; main validates everything. Raw `ipcRenderer` is never exposed, so
 * page code cannot reach other channels. Bundled as CommonJS because
 * sandboxed preloads cannot load ES modules.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { HostEvent } from "../../contracts/desktop/events.js";
import { IPC_CHANNELS, type HarnessBridge } from "../../contracts/desktop/transport.js";

const bridge: HarnessBridge = {
  invoke: (command, params) => ipcRenderer.invoke(IPC_CHANNELS.invoke, command, params),
  selectDirectory: (options) => ipcRenderer.invoke(IPC_CHANNELS.selectDirectory, options),
  onEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: HostEvent) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
    };
  },
};

contextBridge.exposeInMainWorld("harness", bridge);
