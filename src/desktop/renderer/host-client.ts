/**
 * Typed renderer-side client over the preload bridge.
 *
 * `call` unwraps `CommandResponse`: it resolves with the result or throws a
 * `HostCommandError` whose `code` callers can switch on.
 */
import {
  HostCommandError,
  type CommandParams,
  type CommandResult,
  type HarnessBridge,
  type HostCommand,
  type HostEvent,
  type SelectDirectoryOptions,
  type OpenPathRequest,
  type OpenPathResult,
  type AttachmentKind,
} from "../../contracts/desktop/index.js";

declare global {
  interface Window {
    readonly harness: HarnessBridge;
  }
}

export interface HostClient {
  call<C extends HostCommand>(command: C, params: CommandParams<C>): Promise<CommandResult<C>>;
  onEvent(listener: (event: HostEvent) => void): () => void;
  /** Native folder picker; `undefined` when cancelled. */
  selectDirectory(options?: SelectDirectoryOptions): Promise<string | undefined>;
  selectFiles(kind: AttachmentKind): Promise<readonly string[]>;
  /** Opens or reveals a clicked path through Electron main. */
  openPath(request: OpenPathRequest): Promise<OpenPathResult>;
}

export function createHostClient(bridge: HarnessBridge = window.harness): HostClient {
  return {
    async call(command, params) {
      const response = await bridge.invoke(command, params);
      if (!response.ok) {
        throw new HostCommandError(response.error);
      }
      return response.value;
    },
    onEvent: (listener) => bridge.onEvent(listener),
    selectDirectory: (options) => bridge.selectDirectory(options),
    selectFiles: (kind) => bridge.selectFiles(kind),
    openPath: (request) => bridge.openPath(request),
  };
}
