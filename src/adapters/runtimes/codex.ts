import type {
  CredentialResolver,
  RuntimeContextResolver,
} from "../../core/authentication/contracts.js";
import type {
  PermissionMode,
  RuntimeAccountContext,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEvent,
  ReasoningEffortOption,
  RuntimeModel,
  RuntimeModelInput,
  RuntimeRunInput,
} from "../../core/execution/types.js";
import { JsonRpcProcess, type JsonRpcMessage } from "./json-rpc-process.js";

type CodexProcessFactory = (options: {
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}) => Pick<JsonRpcProcess, "request" | "notify" | "respond" | "respondError" | "nextMessage" | "close">;

interface ActiveCodexRun {
  readonly process: ReturnType<CodexProcessFactory>;
  readonly threadId: string;
  readonly turnId: string;
}

/**
 * Codex app-server adapter.
 *
 * All app-server method names and payload shapes stay in this file. Core
 * execution sees only the normalized RuntimeEvent contract, which keeps a
 * future runtime adapter from changing account, session, or run logic.
 */
export class CodexRuntimeAdapter implements RuntimeAdapter {
  readonly runtimeId = "codex-app-server";
  readonly providerId = "codex";
  private readonly active = new Map<string, ActiveCodexRun>();
  private readonly createProcess: CodexProcessFactory;

  constructor(
    private readonly credentials: CredentialResolver,
    private readonly contexts: RuntimeContextResolver,
    options: {
      readonly command?: string;
      readonly args?: readonly string[];
      readonly createProcess?: CodexProcessFactory;
    } = {},
  ) {
    const command = options.command ?? "codex";
    const args = options.args ?? ["app-server", "--stdio"];
    this.createProcess = options.createProcess ?? ((processOptions) =>
      JsonRpcProcess.start(command, args, processOptions));
  }

  /**
   * Read every picker-visible catalog page in the saved account's CODEX_HOME.
   * This short-lived server never starts a thread or turn. Failure is surfaced
   * to the host instead of substituting stale, hard-coded model names.
   */
  async models(input: RuntimeModelInput): Promise<readonly RuntimeModel[]> {
    const credential = await this.credentials.resolve(input.account.credential);
    const context = await this.contexts.resolve(input.account.runtimeContextId);
    const child = this.createProcess({
      cwd: input.projectPath ?? context.directory,
      environment: { ...process.env, ...context.environment, ...credential.environment, CODEX_HOME: context.directory },
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Codex model discovery timed out.")), 15_000);
    });
    try {
      return await Promise.race([this.readModels(child), timeout]);
    } finally {
      clearTimeout(timer);
      await child.close();
    }
  }

  private async readModels(child: ReturnType<CodexProcessFactory>): Promise<readonly RuntimeModel[]> {
    await child.request("initialize", {
      clientInfo: { name: "thinking-and-code", title: "Thinking and Code", version: "0.1.0" },
      capabilities: {},
    });
    child.notify("initialized", {});
    const models = new Map<string, RuntimeModel>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = asRecord(await child.request("model/list", {
        limit: 100, includeHidden: false, ...(cursor === undefined ? {} : { cursor }),
      }));
      if (!Array.isArray(response.data)) throw new Error("Codex returned an invalid model catalog.");
      for (const value of response.data) {
        const entry = asRecord(value);
        if (entry.hidden === true) continue;
        const id = typeof entry.model === "string" ? entry.model : entry.id;
        if (typeof id !== "string" || id.trim() === "") continue;
        const current = models.get(id);
        const efforts = codexReasoningEfforts(entry.supportedReasoningEfforts);
        const defaultEffort = typeof entry.defaultReasoningEffort === "string" && efforts.some((effort) => effort.id === entry.defaultReasoningEffort)
          ? entry.defaultReasoningEffort
          : current?.defaultReasoningEffort;
        models.set(id, {
          id, providerId: this.providerId,
          label: typeof entry.displayName === "string" ? entry.displayName : current?.label ?? id,
          ...(typeof entry.description === "string"
            ? { description: entry.description }
            : current?.description === undefined ? {} : { description: current.description }),
          ...(entry.isDefault === true || current?.isDefault === true ? { isDefault: true } : {}),
          ...(efforts.length > 0 ? { reasoningEfforts: efforts } : current?.reasoningEfforts === undefined ? {} : { reasoningEfforts: current.reasoningEfforts }),
          ...(defaultEffort === undefined ? {} : { defaultReasoningEffort: defaultEffort }),
        });
      }
      cursor = typeof response.nextCursor === "string" ? response.nextCursor : undefined;
      // A broken provider returning the same cursor must not spin indefinitely.
      if (cursor !== undefined && cursors.has(cursor)) throw new Error("Codex repeated a model catalog cursor.");
      if (cursor !== undefined) cursors.add(cursor);
    } while (cursor !== undefined);
    return [...models.values()];
  }

  async capabilities(_account: RuntimeAccountContext): Promise<RuntimeCapabilities> {
    return {
      resume: true,
      fork: false,
      approvals: true,
      quotaReporting: true,
      browserTools: false,
      computerUse: false,
    };
  }

  describePermissionMode(mode: PermissionMode): string {
    const policy = codexPermissionPolicy(mode);
    return `Sandbox '${policy.sandbox}', approval policy '${policy.approvalPolicy}', reviewer '${policy.approvalsReviewer}'.`;
  }

  startRun(input: RuntimeRunInput): AsyncIterable<RuntimeEvent> {
    return this.run(input, false);
  }

  resumeRun(input: RuntimeRunInput): AsyncIterable<RuntimeEvent> {
    return this.run(input, true);
  }

  async cancel(input: Pick<RuntimeRunInput, "attemptId" | "signal">): Promise<void> {
    const active = this.active.get(input.attemptId);
    if (active === undefined) {
      return;
    }
    try {
      await active.process.request("turn/interrupt", {
        threadId: active.threadId,
        turnId: active.turnId,
      });
    } catch {
      // A provider that already exited is already interrupted from the
      // application's perspective. The execution service records that state.
    }
  }

  private async *run(input: RuntimeRunInput, resume: boolean): AsyncIterable<RuntimeEvent> {
    const credential = await this.credentials.resolve(input.account.credential);
    const context = await this.contexts.resolve(input.account.runtimeContextId);
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...context.environment,
      ...credential.environment,
      CODEX_HOME: context.directory,
    };
    const childProcess = this.createProcess({ cwd: input.projectPath, environment });
    let threadId: string | undefined;
    let turnId: string | undefined;
    let assistantText = "";
    const eventState = { thinking: new Map<string, string>(), messages: new Map<string, string>() };

    try {
      await childProcess.request("initialize", {
        clientInfo: {
          name: "thinking-and-code",
          title: "Thinking and Code",
          version: "0.1.0",
        },
        capabilities: {},
      });
      childProcess.notify("initialized", {});

      const threadResponse = resume
        ? await childProcess.request("thread/resume", this.threadResumeParams(input))
        : await childProcess.request("thread/start", this.threadStartParams(input));
      threadId = readString(threadResponse, ["thread", "id"])
        ?? input.continuation?.nativeSessionId;
      if (threadId === undefined) {
        throw new Error("Codex did not return a thread id.");
      }
      yield { type: "native_session", nativeSessionId: threadId };

      const turnResponse = await childProcess.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt }],
        cwd: input.projectPath,
        // Override resumed thread settings at the turn boundary as well. The
        // provider owns review; Rack only forwards prompts in Ask me mode.
        approvalPolicy: codexPermissionPolicy(input.permissionMode).approvalPolicy,
        approvalsReviewer: codexPermissionPolicy(input.permissionMode).approvalsReviewer,
        ...(input.model === undefined ? {} : { model: input.model }),
        // `effort` overrides the thread's reasoning effort for this and later
        // turns, so each Rack turn sends its own choice (or none, keeping the
        // model default). Codex validates the value against the model.
        ...(input.reasoningEffort === undefined ? {} : { effort: input.reasoningEffort }),
      });
      turnId = readString(turnResponse, ["turn", "id"]);
      if (turnId === undefined) {
        throw new Error("Codex did not return a turn id.");
      }
      this.active.set(input.attemptId, { process: childProcess, threadId, turnId });

      for (;;) {
        const next = await childProcess.nextMessage();
        if (next.done) {
          throw new Error("Codex app-server ended before the turn completed.");
        }
        const message = next.value;
        if (message.id !== undefined && message.method !== undefined) {
          yield* await this.handleServerRequest(childProcess, message, input);
          continue;
        }
        if (message.method === undefined) {
          continue;
        }
        const events = mapCodexNotification(message.method, message.params, eventState);
        for (const event of events) {
          if (event.type === "message_delta") {
            assistantText += event.text;
          }
          yield event;
        }
        if (message.method === "turn/completed") {
          const completion = completionFromTurn(message.params, assistantText);
          if (completion.type === "failed") {
            const availability = codexAvailability(completion.error);
            if (availability !== undefined) {
              yield availability;
            }
          }
          yield completion;
          break;
        }
      }
    } catch (error) {
      if (input.signal.aborted) {
        yield { type: "interrupted" };
      } else {
        yield { type: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    } finally {
      this.active.delete(input.attemptId);
      await childProcess.close();
    }
  }

  private threadStartParams(input: RuntimeRunInput): Record<string, unknown> {
    const policy = codexPermissionPolicy(input.permissionMode);
    return {
      cwd: input.projectPath,
      ...(input.model === undefined ? {} : { model: input.model }),
      sandbox: policy.sandbox,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
    };
  }

  private threadResumeParams(input: RuntimeRunInput): Record<string, unknown> {
    const policy = codexPermissionPolicy(input.permissionMode);
    return {
      threadId: input.continuation?.nativeSessionId,
      cwd: input.projectPath,
      ...(input.model === undefined ? {} : { model: input.model }),
      sandbox: policy.sandbox,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
    };
  }

  private async *handleServerRequest(
    process: ReturnType<CodexProcessFactory>,
    message: JsonRpcMessage,
    input: RuntimeRunInput,
  ): AsyncIterable<RuntimeEvent> {
    if (message.id === undefined || message.method === undefined) {
      return;
    }
    if (
      message.method === "item/commandExecution/requestApproval" ||
      message.method === "item/fileChange/requestApproval" ||
      message.method === "item/permissions/requestApproval"
    ) {
      const params = asRecord(message.params);
      if (input.permissionMode !== "ask") {
        // Never quietly replace automatic/native enforcement with an app
        // prompt or an unconditional allow if the provider routes one here.
        process.respond(message.id, codexApprovalResponse(message.method, "deny", params));
        if (input.permissionMode !== "read_only") {
          throw new Error(`Codex requested manual approval while '${input.permissionMode}' was selected. Its native permission settings could not resolve this action.`);
        }
        return;
      }
      const decision = await input.requestApproval({
        tool: message.method,
        input: params,
        ...(typeof params.reason === "string" ? { reason: params.reason } : {}),
      });
      process.respond(message.id, codexApprovalResponse(message.method, decision, params));
      return;
    }
    process.respondError(message.id, `Unsupported Codex server request '${message.method}'.`);
  }
}

function codexPermissionPolicy(mode: PermissionMode): {
  readonly sandbox: "read-only" | "workspace-write" | "danger-full-access";
  readonly approvalPolicy: "untrusted" | "on-request" | "never";
  readonly approvalsReviewer: "user" | "auto_review";
} {
  switch (mode) {
    case "read_only":
      return { sandbox: "read-only", approvalPolicy: "never", approvalsReviewer: "user" };
    case "full_access":
      return { sandbox: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "user" };
    case "approve_for_me":
      return { sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" };
    case "ask":
      return { sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" };
  }
}

function codexApprovalResponse(
  method: string,
  decision: "allow" | "deny",
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (method === "item/permissions/requestApproval") {
    return {
      permissions: decision === "allow" ? params.permissions ?? {} : {},
      scope: "turn",
    };
  }
  return { decision: decision === "allow" ? "accept" : "decline" };
}

interface CodexEventState {
  readonly thinking: Map<string, string>;
  readonly messages: Map<string, string>;
}

/** Correlate native items and keep summaries separate from exposed trace text. */
function mapCodexNotification(method: string, rawParams: unknown, state: CodexEventState): RuntimeEvent[] {
  const params = asRecord(rawParams);
  const nativeId = typeof params.itemId === "string" ? params.itemId : undefined;
  const callId = nativeId === undefined ? {} : { toolCallId: nativeId };
  switch (method) {
    case "item/agentMessage/delta": {
      if (typeof params.delta !== "string") return [];
      if (nativeId !== undefined) state.messages.set(nativeId, (state.messages.get(nativeId) ?? "") + params.delta);
      return [{ type: "message_delta", text: params.delta }];
    }
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      if (typeof params.delta !== "string") return [];
      const format = method.includes("summary") ? "summary" : "trace";
      const part = format === "summary" ? params.summaryIndex : params.contentIndex;
      const traceId = nativeId === undefined ? undefined : `${nativeId}:${format}:${typeof part === "number" ? part : 0}`;
      if (traceId !== undefined) state.thinking.set(traceId, (state.thinking.get(traceId) ?? "") + params.delta);
      return [{ type: "thinking_delta", text: params.delta, format, ...(traceId === undefined ? {} : { traceId }) }];
    }
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
      return typeof params.delta === "string" ? [{ type: "tool_output_delta", text: params.delta, ...callId }] : [];
    case "item/started": {
      const item = asRecord(params.item);
      const itemType = typeof item.type === "string" ? item.type : "item";
      if (["agentMessage", "reasoning", "userMessage", "plan", "contextCompaction"].includes(itemType)) return [];
      return [{ type: "tool_request", tool: itemType, input: item,
        ...(typeof item.id === "string" ? { toolCallId: item.id } : {}) }];
    }
    case "item/completed": {
      const item = asRecord(params.item);
      if (item.type === "agentMessage") {
        if (typeof item.text !== "string") return [];
        const previous = typeof item.id === "string" ? state.messages.get(item.id) ?? "" : "";
        const text = item.text.startsWith(previous) ? item.text.slice(previous.length) : "";
        return text === "" ? [] : [{ type: "message_delta", text }];
      }
      if (item.type === "reasoning") {
        const events: RuntimeEvent[] = [];
        for (const format of ["trace", "summary"] as const) {
          const parts = format === "trace" ? item.content : item.summary;
          for (const [index, part] of (Array.isArray(parts) ? parts : []).entries()) {
            if (typeof part !== "string" || part === "") continue;
            const traceId = typeof item.id === "string" ? `${item.id}:${format}:${index}` : undefined;
            const previous = traceId === undefined ? "" : state.thinking.get(traceId) ?? "";
            const text = part.startsWith(previous) ? part.slice(previous.length) : "";
            if (text !== "") events.push({ type: "thinking_delta", text, format, ...(traceId === undefined ? {} : { traceId }) });
          }
        }
        return events;
      }
      if (["userMessage", "plan", "contextCompaction"].includes(String(item.type))) return [];
      return [{ type: "tool_result", output: item,
        ...(typeof item.id === "string" ? { toolCallId: item.id } : {}),
        isError: item.status === "failed" || item.status === "declined" || item.success === false
          || (typeof item.exitCode === "number" && item.exitCode !== 0) }];
    }
    case "thread/tokenUsage/updated": {
      const usage = asRecord(params.tokenUsage ?? params);
      const event: Extract<RuntimeEvent, { type: "usage" }> = { type: "usage" };
      const inputTokens = numberValue(usage.inputTokens);
      const outputTokens = numberValue(usage.outputTokens);
      const costUsd = numberValue(usage.totalCostUsd);
      return [{
        ...event,
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
        ...(costUsd === undefined ? {} : { costUsd }),
      }];
    }
    default:
      return [];
  }
}

function completionFromTurn(rawParams: unknown, assistantText: string): RuntimeEvent {
  const turn = asRecord(asRecord(rawParams).turn);
  const status = typeof turn.status === "string" ? turn.status : "completed";
  const error = turn.error;
  if (status === "interrupted" || status === "cancelled") {
    return { type: "interrupted" };
  }
  if (status !== "completed") {
    return {
      type: "failed",
      error: typeof error === "string" ? error : JSON.stringify(error ?? turn),
      retryable: true,
    };
  }
  return { type: "completed", result: assistantText };
}

function codexAvailability(error: string): Extract<RuntimeEvent, { type: "availability" }> | undefined {
  const normalized = error.toLowerCase();
  if (normalized.includes("unauthorized") || normalized.includes("authentication")) {
    return { type: "availability", status: "reauth_required", reason: error };
  }
  if (
    normalized.includes("rate limit") ||
    normalized.includes("usage limit") ||
    normalized.includes("quota") ||
    normalized.includes("credits")
  ) {
    return { type: "availability", status: "unavailable", reason: error };
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function readString(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const segment of path) {
    current = asRecord(current)[segment];
  }
  return typeof current === "string" ? current : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Reads `Model.supportedReasoningEfforts` from `model/list`
 * (`[{ reasoningEffort, description }]`). Codex types the level as a free
 * string, so values are kept as reported; malformed or duplicate entries are
 * skipped rather than failing the whole catalog.
 */
function codexReasoningEfforts(value: unknown): ReasoningEffortOption[] {
  if (!Array.isArray(value)) return [];
  const options: ReasoningEffortOption[] = [];
  for (const raw of value) {
    const entry = asRecord(raw);
    const id = entry.reasoningEffort;
    if (typeof id !== "string" || id.trim() === "" || options.some((option) => option.id === id)) continue;
    options.push({ id, ...(typeof entry.description === "string" && entry.description !== "" ? { description: entry.description } : {}) });
  }
  return options;
}
