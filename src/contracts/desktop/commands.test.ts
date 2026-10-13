import assert from "node:assert/strict";
import test from "node:test";

import { isHostCommand, validateCommandParams } from "./commands.js";
import { ContractValidationError } from "./validation.js";

test("only declared commands are accepted", () => {
  assert.equal(isHostCommand("runs.start"), true);
  assert.equal(isHostCommand("constructor"), false);
  assert.equal(isHostCommand("toString"), false);
  assert.equal(isHostCommand(42), false);
});

test("parameters are validated, optional keys are omitted, and extra keys rejected", () => {
  const params = validateCommandParams("workspaces.create", { projectId: "p", path: "/x", startingRevision: undefined });
  assert.deepEqual(params, { projectId: "p", path: "/x" });

  assert.throws(() => validateCommandParams("workspaces.create", { projectId: "p", path: "/x", kind: "other" }), ContractValidationError);
  assert.throws(() => validateCommandParams("runs.cancel", { runId: "r", extra: 1 }), /runs?|extra/);
  assert.throws(() => validateCommandParams("runs.start", null), ContractValidationError);
  assert.throws(
    () => validateCommandParams("accounts.register", {
      providerId: "a",
      providerAccountId: "b",
      credential: { id: "c", providerId: "a" },
      runtimeContextId: "d",
    }),
    /credential\.method/,
  );
});

test("parameterless commands accept undefined", () => {
  assert.deepEqual(validateCommandParams("accounts.list", undefined), {});
});
