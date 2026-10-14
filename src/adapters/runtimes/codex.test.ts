import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeModelInput } from "../../core/execution/types.js";
import { CodexRuntimeAdapter } from "./codex.js";

test("Codex applies native permission policy and reviewer on new/resumed threads and turns", async () => {
  for (const [mode, sandbox, approvalPolicy, approvalsReviewer] of [
    ["ask", "workspace-write", "on-request", "user"],
    ["approve_for_me", "workspace-write", "on-request", "auto_review"],
    ["full_access", "danger-full-access", "never", "user"],
    ["read_only", "read-only", "never", "user"],
  ] as const) {
    for (const resume of [false, true]) {
      const requests: { method: string; params: any }[] = [];
      const adapter = new CodexRuntimeAdapter({ resolve: async () => ({ environment: {} }) },
        { resolve: async () => ({ directory: "/context" }) }, { createProcess: () => ({
          request: async (method, params) => {
            requests.push({ method, params });
            return method.startsWith("thread/") ? { thread: { id: "thread" } } : method === "turn/start" ? { turn: { id: "turn" } } : {};
          }, notify: () => {}, respond: () => {}, respondError: () => {}, close: async () => {},
          nextMessage: async () => ({ done: false, value: { method: "turn/completed", params: { turn: { status: "completed" } } } }),
        }) });
      const input: import("../../core/execution/types.js").RuntimeRunInput = {
        runId: "run", attemptId: "attempt", sessionId: "session", projectPath: "/project", prompt: "test", permissionMode: mode,
        account: { accountId: "account", providerId: "codex", credential: { id: "credential", providerId: "codex", method: "native_login" }, runtimeContextId: "context" },
        signal: new AbortController().signal, requestApproval: async () => { throw new Error("Unexpected Rack prompt"); },
        ...(resume ? { continuation: { nativeSessionId: "thread" } } : {}),
      };
      const events = [];
      for await (const event of resume ? adapter.resumeRun(input) : adapter.startRun(input)) events.push(event);
      assert.equal(events.at(-1)?.type, "completed");
      const thread = requests.find((request) => request.method === (resume ? "thread/resume" : "thread/start"))!;
      assert.equal(thread.params.sandbox, sandbox);
      assert.equal(thread.params.approvalPolicy, approvalPolicy);
      assert.equal(thread.params.approvalsReviewer, approvalsReviewer);
      const turn = requests.find((request) => request.method === "turn/start")!;
      assert.equal(turn.params.approvalPolicy, approvalPolicy);
      assert.equal(turn.params.approvalsReviewer, approvalsReviewer);
    }
  }
});

test("Codex does not turn native automatic review into an interactive Rack approval", async () => {
  let response: unknown;
  let closed = false;
  const adapter = new CodexRuntimeAdapter({ resolve: async () => ({ environment: {} }) },
    { resolve: async () => ({ directory: "/context" }) }, { createProcess: () => ({
      request: async (method) => method === "thread/start" ? { thread: { id: "thread" } } : method === "turn/start" ? { turn: { id: "turn" } } : {},
      notify: () => {}, respond: (_id, result) => { response = result; }, respondError: () => {}, close: async () => { closed = true; },
      nextMessage: async () => ({ done: false, value: { id: "approval", method: "item/commandExecution/requestApproval", params: { command: "pwd" } } }),
    }) });
  const events = [];
  for await (const event of adapter.startRun({ runId: "run", attemptId: "attempt", sessionId: "session", projectPath: "/project", prompt: "test", permissionMode: "approve_for_me",
    account: { accountId: "account", providerId: "codex", credential: { id: "credential", providerId: "codex", method: "native_login" }, runtimeContextId: "context" },
    signal: new AbortController().signal, requestApproval: async () => { throw new Error("Unexpected Rack prompt"); } })) events.push(event);
  assert.deepEqual(response, { decision: "decline" });
  const last = events.at(-1);
  assert.equal(last?.type, "failed");
  assert.match(last?.type === "failed" ? last.error : "", /native permission settings/);
  assert.equal(closed, true);
});

test("Codex model discovery paginates, hides entries, and closes the process", async () => {
  const requests: string[] = [];
  const notifications: string[] = [];
  let page = 0;
  let closed = false;
  const adapter = new CodexRuntimeAdapter(
    { resolve: async () => ({ environment: {} }) },
    { resolve: async () => ({ directory: "/contexts/account-1" }) },
    {
      createProcess: () => ({
        request: async (method: string) => {
          requests.push(method);
          if (method === "initialize") return {};
          page += 1;
          return page === 1
            ? {
              data: [
                { model: "gpt-5", displayName: "GPT-5", isDefault: true },
                { model: "hidden", displayName: "Hidden", hidden: true },
              ],
              nextCursor: "page-2",
            }
            : { data: [{ model: "gpt-5", displayName: "GPT-5" }, { id: "o3", displayName: "o3" }] };
        },
        notify: (method: string) => { notifications.push(method); },
        respond: () => undefined,
        respondError: () => undefined,
        nextMessage: async () => ({ done: true, value: undefined }),
        close: async () => { closed = true; },
      }),
    },
  );

  const input: RuntimeModelInput = {
    account: {
      accountId: "account-1",
      providerId: "codex",
      credential: { id: "credential-1", providerId: "codex", method: "native_login" },
      runtimeContextId: "context-1",
    },
    projectPath: "/project/folder",
  };
  const models = await adapter.models(input);

  assert.deepEqual(models.map((model) => model.id), ["gpt-5", "o3"]);
  assert.equal(models[0]?.isDefault, true);
  assert.deepEqual(requests, ["initialize", "model/list", "model/list"]);
  assert.deepEqual(notifications, ["initialized"]);
  assert.equal(closed, true);
});

test("Codex exposes distinct trace/summary text, correlates tools, and ignores non-tool completions", async () => {
  const input: import("../../core/execution/types.js").RuntimeRunInput = {
    runId: "run", attemptId: "attempt", sessionId: "session", projectPath: "/project",
    account: { accountId: "account", providerId: "codex", credential: { id: "credential", providerId: "codex", method: "native_login" }, runtimeContextId: "context" },
    prompt: "test", permissionMode: "read_only", signal: new AbortController().signal, requestApproval: async () => "deny",
  };
  const messages = [
    { method: "item/reasoning/summaryTextDelta", params: { itemId: "reason", summaryIndex: 0, delta: "Summary" } },
    { method: "item/reasoning/textDelta", params: { itemId: "reason", contentIndex: 0, delta: "Visible trace" } },
    { method: "item/started", params: { item: { type: "commandExecution", id: "call", command: "printf done" } } },
    { method: "item/commandExecution/outputDelta", params: { itemId: "call", delta: "done" } },
    { method: "item/completed", params: { item: { type: "commandExecution", id: "call", aggregatedOutput: "done", exitCode: 0 } } },
    { method: "item/completed", params: { item: { type: "reasoning", id: "reason", summary: ["Summary"], content: ["Visible trace"] } } },
    { method: "item/agentMessage/delta", params: { itemId: "reply", delta: "Done" } },
    { method: "item/completed", params: { item: { type: "agentMessage", id: "reply", text: "Done" } } },
    { method: "turn/completed", params: { turn: { status: "completed" } } },
  ];
  const adapter = new CodexRuntimeAdapter(
    { resolve: async () => ({ environment: {} }) }, { resolve: async () => ({ directory: "/context" }) },
    { createProcess: () => ({
      request: async (method) => method === "thread/start" ? { thread: { id: "thread" } } : method === "turn/start" ? { turn: { id: "turn" } } : {},
      notify: () => {}, respond: () => {}, respondError: () => {}, close: async () => {},
      nextMessage: async () => { const value = messages.shift(); return value === undefined ? { done: true, value: undefined } : { done: false, value }; },
    }) },
  );
  const events = [];
  for await (const event of adapter.startRun(input)) events.push(event);
  assert.deepEqual(events.filter((event) => event.type === "thinking_delta").map((event) => event.type === "thinking_delta" ? [event.format, event.text] : []), [["summary", "Summary"], ["trace", "Visible trace"]]);
  const results = events.filter((event) => event.type === "tool_result");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.toolCallId, "call");
  assert.equal(events.filter((event) => event.type === "tool_output_delta").length, 1);
  assert.equal(events.filter((event) => event.type === "message_delta").map((event) => event.type === "message_delta" ? event.text : "").join(""), "Done");
});

test("Codex reports per-model reasoning efforts and forwards the chosen effort on turn/start", async () => {
  const requests: { method: string; params: any }[] = [];
  const adapter = new CodexRuntimeAdapter({ resolve: async () => ({ environment: {} }) },
    { resolve: async () => ({ directory: "/context" }) }, { createProcess: () => ({
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "model/list") {
          return { data: [
            { model: "gpt-5", displayName: "GPT-5", defaultReasoningEffort: "medium", supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Fast" },
              { reasoningEffort: "medium", description: "Balanced" },
              { reasoningEffort: "xhigh", description: "Deepest" },
              { reasoningEffort: "low", description: "Duplicate" },
              { description: "Malformed" },
            ] },
            // A default the model does not list is not offered as a default.
            { model: "mini", displayName: "Mini", defaultReasoningEffort: "high", supportedReasoningEfforts: [] },
          ] };
        }
        return method.startsWith("thread/") ? { thread: { id: "thread" } } : method === "turn/start" ? { turn: { id: "turn" } } : {};
      }, notify: () => {}, respond: () => {}, respondError: () => {}, close: async () => {},
      nextMessage: async () => ({ done: false, value: { method: "turn/completed", params: { turn: { status: "completed" } } } }),
    }) });
  const account = { accountId: "account", providerId: "codex", credential: { id: "credential", providerId: "codex", method: "native_login" as const }, runtimeContextId: "context" };

  const models = await adapter.models({ account });
  assert.deepEqual(models[0]?.reasoningEfforts, [
    { id: "low", description: "Fast" }, { id: "medium", description: "Balanced" }, { id: "xhigh", description: "Deepest" },
  ]);
  assert.equal(models[0]?.defaultReasoningEffort, "medium");
  assert.equal(models[1]?.reasoningEfforts, undefined);
  assert.equal(models[1]?.defaultReasoningEffort, undefined);

  for (const effort of ["xhigh", undefined]) {
    requests.length = 0;
    for await (const _event of adapter.startRun({ runId: "run", attemptId: "attempt", sessionId: "session", projectPath: "/project", prompt: "test",
      permissionMode: "ask", account, signal: new AbortController().signal, requestApproval: async () => "allow",
      ...(effort === undefined ? {} : { reasoningEffort: effort }) })) { /* Drain. */ }
    const turn = requests.find((request) => request.method === "turn/start")!;
    // Omitted effort must not send a key at all, so Codex keeps the model default.
    assert.equal("effort" in turn.params, effort !== undefined);
    if (effort !== undefined) assert.equal(turn.params.effort, effort);
  }
});

test("Codex reports service tiers as speeds with a standard option and sends serviceTierForTurn", async () => {
  const requests: { method: string; params: any }[] = [];
  const adapter = new CodexRuntimeAdapter({ resolve: async () => ({ environment: {} }) },
    { resolve: async () => ({ directory: "/context" }) }, { createProcess: () => ({
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "model/list") {
          return { data: [
            { model: "gpt-5", displayName: "GPT-5", defaultServiceTier: null, serviceTiers: [
              { id: "priority", name: "Fast", description: "Priority processing" }, { id: "priority", name: "Duplicate" }, { name: "No id" },
            ] },
            { model: "legacy", displayName: "Legacy", additionalSpeedTiers: ["fast"] },
            { model: "plain", displayName: "Plain", serviceTiers: [] },
          ] };
        }
        return method.startsWith("thread/") ? { thread: { id: "thread" } } : method === "turn/start" ? { turn: { id: "turn" } } : {};
      }, notify: () => {}, respond: () => {}, respondError: () => {}, close: async () => {},
      nextMessage: async () => ({ done: false, value: { method: "turn/completed", params: { turn: { status: "completed" } } } }),
    }) });
  const account = { accountId: "account", providerId: "codex", credential: { id: "credential", providerId: "codex", method: "native_login" as const }, runtimeContextId: "context" };
  const models = await adapter.models({ account });
  // A null default means standard speed, which stays selectable.
  assert.deepEqual(models[0]?.speeds, [
    { id: "default", label: "Standard", fast: false, description: "Codex standard speed" },
    { id: "priority", label: "Fast", fast: true, description: "Priority processing" },
  ]);
  assert.equal(models[0]?.defaultSpeed, "default");
  assert.deepEqual(models[1]?.speeds?.map((speed) => speed.id), ["default", "fast"]);
  assert.equal(models[2]?.speeds, undefined);

  for (const speed of ["priority", undefined]) {
    requests.length = 0;
    for await (const _event of adapter.startRun({ runId: "run", attemptId: "attempt", sessionId: "session", projectPath: "/project", prompt: "test",
      permissionMode: "ask", account, signal: new AbortController().signal, requestApproval: async () => "allow",
      ...(speed === undefined ? {} : { speed }) })) { /* Drain. */ }
    const turn = requests.find((request) => request.method === "turn/start")!;
    assert.equal("serviceTierForTurn" in turn.params, speed !== undefined);
    // The per-turn field is used so the thread's own tier is never rewritten.
    assert.equal("serviceTier" in turn.params, false);
    if (speed !== undefined) assert.equal(turn.params.serviceTierForTurn, speed);
  }
});
