/**
 * Execution host entry point, launched by Electron main as a utility process.
 *
 * The host owns the composed application (accounts, sessions, execution,
 * runtime adapters, persistence) and all in-flight runs. Running it outside
 * the main process keeps provider processes and JSON persistence off the
 * window event loop, and gives the future background mode a process whose
 * lifetime can be decoupled from windows without moving application code.
 *
 * Protocol (see `contracts/desktop/transport.ts`):
 * - on start, the host posts `{ kind: "ready" }`;
 * - each `request` is answered with exactly one `response` carrying the same
 *   ID; requests are handled concurrently;
 * - host events are posted as `{ kind: "event" }` at any time;
 * - `shutdown` cancels active runs, waits up to `timeoutMs`, replies, and
 *   leaves process termination to main.
 *
 * The data directory may be overridden with `--data-directory=<path>`;
 * otherwise `createApplication`'s default is used, so the desktop app and
 * headless embedders share the same local records.
 */
import { createApplication } from "../../composition/application.js";
import type { HostInbound, HostOutbound } from "../../contracts/desktop/transport.js";
import { HostApi } from "./host-api.js";

/** The subset of Electron's `process.parentPort` that the host uses. */
interface ParentPort {
  on(event: "message", listener: (message: { readonly data: unknown }) => void): void;
  postMessage(message: HostOutbound): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (parentPort === undefined) {
  throw new Error("The execution host must be started as an Electron utility process.");
}
const port: ParentPort = parentPort;

const dataDirectoryArgument = process.argv
  .find((argument) => argument.startsWith("--data-directory="))
  ?.slice("--data-directory=".length);

const application = createApplication(
  dataDirectoryArgument === undefined ? {} : { dataDirectory: dataDirectoryArgument },
);
const api = new HostApi(application, (event) => port.postMessage({ kind: "event", event }));

port.on("message", ({ data }) => {
  const message = data as HostInbound;
  if (message.kind === "request") {
    void api.dispatch(message.command, message.params).then((response) => {
      port.postMessage({ kind: "response", id: message.id, response });
    });
  } else if (message.kind === "shutdown") {
    void api.shutdown(message.timeoutMs).then((remaining) => {
      port.postMessage({ kind: "response", id: message.id, response: { ok: true, value: remaining } });
    });
  }
});

port.postMessage({ kind: "ready" });
