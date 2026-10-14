import assert from "node:assert/strict";
import test from "node:test";
import { diffFiles } from "./change-diff.js";

test("diff panels split files and count hunk additions/deletions without counting headers", () => {
  const files = diffFiles('diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git "a/new file.ts" "b/new file.ts"\nnew file mode 100644\n--- /dev/null\n+++ "b/new file.ts"\n@@ -0,0 +1 @@\n+created\n');
  assert.deepEqual(files.map(({ title, added, removed }) => ({ title, added, removed })), [
    { title: "app.ts", added: 1, removed: 1 }, { title: "new file.ts", added: 1, removed: 0 },
  ]);
  assert.deepEqual(diffFiles(""), []);
  assert.equal(diffFiles("diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted\n")[0]?.title, "gone.ts");
});
