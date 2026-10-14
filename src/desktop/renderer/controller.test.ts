import assert from "node:assert/strict";
import test from "node:test";
import { Controller } from "./controller.js";
import { INITIAL_STATE, Store } from "./store.js";
import type { HostClient } from "./host-client.js";
import type { RunView } from "../../contracts/desktop/views.js";
import type { HostEvent } from "../../contracts/desktop/events.js";
import { foldEvents } from "./transcript.js";

// The controller is tested with view state, not a browser or native UI.
class ImmediateStore extends Store {
  private value = INITIAL_STATE;
  override get() { return this.value; }
  override update(change: Parameters<Store["update"]>[0]) { this.value = change(this.value); }
}
const stamp = "2026-10-14T00:00:00.000Z";
const run: RunView = { id: "run", sessionId: "session", projectId: "project", prompt: "Task", providerId: "fake", accountId: "account",
  permissionMode: "ask", status: "completed", attemptIds: [], attempts: [], createdAt: stamp, updatedAt: stamp };
const session = { id: "session", projectId: "project", messages: [], continuations: [], createdAt: stamp, updatedAt: stamp };

test("live thinking and response chunks update view state before run completion", async () => {
  const store = new ImmediateStore();
  let emit!: (event: HostEvent) => void;
  const host = { onEvent: (listener: typeof emit) => { emit = listener; return () => {}; }, selectDirectory: async () => undefined,
    call: async (command: string) => command === "models.list" ? { models: [], failures: [] } : [],
  } as unknown as HostClient;
  await new Controller(host, store).start();
  store.update((state) => ({ ...state, session, selection: { projectId: "project", sessionId: "session" } }));
  emit({ type: "run.started", run: { ...run, status: "running" } });
  emit({ type: "run.event", runId: run.id, index: 0, event: { type: "thinking_delta", text: "Checking ", traceId: "trace", format: "trace" } });
  emit({ type: "run.event", runId: run.id, index: 1, event: { type: "thinking_delta", text: "files", traceId: "trace", format: "trace" } });
  emit({ type: "run.event", runId: run.id, index: 2, event: { type: "message_delta", text: "Hello " } });
  const before = store.get().live[run.id]!.events;
  assert.equal(store.get().live[run.id]?.run.status, "running");
  assert.equal(foldEvents(before).items[0]?.kind === "thinking" && foldEvents(before).items[0]?.text, "Checking files");
  emit({ type: "run.event", runId: run.id, index: 3, event: { type: "message_delta", text: "world" } });
  const current = store.get().live[run.id]!.events;
  assert.notEqual(current, before);
  assert.equal(before.length, 3);
  assert.equal(foldEvents(current).items[1]?.kind === "text" && foldEvents(current).items[1]?.text, "Hello world");
});

test("batch import retains successes and reports only failed source selections", async () => {
  const store = new ImmediateStore();
  store.update((state) => ({ ...state, sessions: [{ ...session, messageCount: 0 }] }));
  const calls: string[] = [];
  const host = { onEvent: () => () => {}, selectDirectory: async () => undefined,
    call: async (command: string, params: { nativeSessionId?: string }) => {
      calls.push(command);
      if (command === "sessions.import") {
        if (params.nativeSessionId === "bad") throw new Error("Unavailable source");
        return { session, alreadyImported: false };
      }
      if (command === "sessions.list") return [{ ...session, messageCount: 0 }];
      if (command === "sessions.get") return session;
      if (command === "runs.list" || command === "projects.list") return [];
      if (command === "models.list") return { models: [], failures: [] };
      throw new Error(command);
    },
  } as unknown as HostClient;
  const result = await new Controller(host, store).importSessions("project", [
    { sourceId: "source", nativeSessionId: "good" }, { sourceId: "source", nativeSessionId: "bad" },
  ]);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0]?.sessionId, session.id);
  assert.deepEqual(result.failed, [{ sourceId: "source", nativeSessionId: "bad" }]);
  assert.equal(calls.filter((command) => command === "sessions.list").length, 1);
  assert.equal(store.get().selection.sessionId, session.id);
});

test("opening a completed session restores saved thinking and tool activity from its journal", async () => {
  const store = new ImmediateStore();
  store.update((state) => ({ ...state, sessions: [{ ...session, messageCount: 0 }] }));
  const host = { onEvent: () => () => {}, selectDirectory: async () => undefined, call: async (command: string) => {
    if (command === "sessions.get") return session;
    if (command === "runs.list") return [run];
    if (command === "projects.list") return [];
    if (command === "models.list") return { models: [], failures: [] };
    if (command === "runs.journal") return [
      { sequence: 1, type: "run_started", payload: {} },
      { sequence: 2, type: "thinking_delta", payload: { type: "thinking_delta", text: "Saved thought", format: "trace" } },
      { sequence: 3, type: "tool_request", payload: { type: "tool_request", tool: "read", input: { path: "file.ts" }, toolCallId: "tool" } },
      { sequence: 4, type: "tool_result", payload: { type: "tool_result", output: "content", toolCallId: "tool" } },
    ];
    throw new Error(command);
  } } as unknown as HostClient;
  await new Controller(host, store).selectSession(session.id);
  assert.equal(store.get().transcripts[run.id]?.length, 3);
  assert.equal(store.get().transcripts[run.id]?.[0]?.type, "thinking_delta");
});
