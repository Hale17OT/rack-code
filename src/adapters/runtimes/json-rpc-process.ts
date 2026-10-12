import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { AsyncQueue } from "../../core/shared/async-queue.js";

export interface JsonRpcMessage {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message: string; readonly data?: unknown };
}

/**
 * Line-delimited JSON-RPC transport for local provider runtimes.
 *
 * The transport owns process lifetime and request correlation. Provider
 * adapters interpret method names and payloads above this boundary.
 */
export class JsonRpcProcess {
  private readonly messages = new AsyncQueue<JsonRpcMessage>();
  private readonly pending = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  private closed = false;

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.receive(line));
    // Providers write diagnostics to stderr independently of the JSON-RPC
    // stream. Consume it even when the host does not display diagnostics so a
    // verbose provider cannot fill the pipe and deadlock the run.
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => this.fail(error));
    child.on("close", (code, signal) => {
      this.fail(new Error(`Provider process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`));
    });
  }

  static start(command: string, args: readonly string[], options: {
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
  }): JsonRpcProcess {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new JsonRpcProcess(child);
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.write({ id, method, params });
    return result;
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  respond(id: string | number, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: string | number, message: string, code = -32000): void {
    this.write({ id, error: { code, message } });
  }

  async nextMessage(): Promise<IteratorResult<JsonRpcMessage>> {
    return this.messages.next();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.messages.complete();
    this.child.kill();
    await new Promise<void>((resolve) => {
      this.child.once("close", () => resolve());
      setTimeout(resolve, 1000);
    });
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed || this.child.stdin.destroyed) {
      throw new Error("Provider process is closed.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    if (line.trim() === "") {
      return;
    }
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    this.messages.push(message);
  }

  private fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.messages.fail(error);
  }
}
