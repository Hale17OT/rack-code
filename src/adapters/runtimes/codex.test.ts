import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeModelInput } from "../../core/execution/types.js";
import { CodexRuntimeAdapter } from "./codex.js";

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
    workspacePath: "/workspace/project",
  };
  const models = await adapter.models(input);

  assert.deepEqual(models.map((model) => model.id), ["gpt-5", "o3"]);
  assert.equal(models[0]?.isDefault, true);
  assert.deepEqual(requests, ["initialize", "model/list", "model/list"]);
  assert.deepEqual(notifications, ["initialized"]);
  assert.equal(closed, true);
});
