import assert from "node:assert/strict";
import test from "node:test";

import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeModelInput } from "../../core/execution/types.js";
import { ClaudeRuntimeAdapter } from "./claude.js";

test("Claude model discovery maps supportedModels and closes the idle query", async () => {
  let closed = false;
  const query = {
    supportedModels: async () => [
      { value: "sonnet", displayName: "Sonnet", description: "Balanced model" },
      { value: "", displayName: "", description: "" },
    ],
    close: () => { closed = true; },
  } as unknown as Query;
  const createQuery = (() => query) as unknown as typeof import("@anthropic-ai/claude-agent-sdk").query;
  const adapter = new ClaudeRuntimeAdapter(
    { resolve: async () => ({ environment: {} }) },
    { resolve: async () => ({ directory: "/contexts/account-1" }) },
    createQuery,
  );

  const input: RuntimeModelInput = {
    account: {
      accountId: "account-1",
      providerId: "claude",
      credential: { id: "credential-1", providerId: "claude", method: "native_login" },
      runtimeContextId: "context-1",
    },
  };
  const models = await adapter.models(input);

  assert.deepEqual(models, [{
    id: "sonnet",
    label: "Sonnet",
    description: "Balanced model",
    providerId: "claude",
  }]);
  assert.equal(closed, true);
});
