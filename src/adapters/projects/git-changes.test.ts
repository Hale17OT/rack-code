import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitProjectChangesReader } from "./git-changes.js";

const execute = promisify(execFile);

test("project diff reads staged, unstaged, new and binary files without modifying the index", async () => {
  const path = await mkdtemp(join(tmpdir(), "rack-diff-"));
  const git = async (...args: string[]) => (await execute("git", ["-C", path, ...args])).stdout;
  try {
    await git("init", "-q");
    await writeFile(join(path, "tracked.txt"), "original\n");
    await git("add", "tracked.txt");
    await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "Initial fixture");
    await writeFile(join(path, "tracked.txt"), "staged\n");
    await git("add", "tracked.txt");
    await writeFile(join(path, "tracked.txt"), "working\n");
    await writeFile(join(path, "new file.txt"), "new code\n");
    await writeFile(join(path, "binary.bin"), Buffer.from([0, 1, 2]));
    await writeFile(join(path, ".gitignore"), "ignored.txt\n");
    await writeFile(join(path, "ignored.txt"), "hidden\n");
    await symlink("tracked.txt", join(path, "link.txt"));
    const index = await readFile(join(path, ".git/index"));
    const snapshot = await new GitProjectChangesReader().read(path);
    assert.equal(snapshot.status, "ready");
    assert.equal(snapshot.truncated, false);
    assert.match(snapshot.diff, /-original\n\+working/);
    assert.match(snapshot.diff, /\+new code/);
    assert.match(snapshot.diff, /Binary file/);
    assert.doesNotMatch(snapshot.diff, /ignored\.txt.*diff|link\.txt/);
    assert.deepEqual(await readFile(join(path, ".git/index")), index);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("diff handles repositories without commits, scopes subfolders, and labels non-Git folders", async () => {
  const path = await mkdtemp(join(tmpdir(), "rack-diff-empty-"));
  try {
    const reader = new GitProjectChangesReader();
    assert.equal((await reader.read(path)).status, "not_git");
    await execute("git", ["-C", path, "init", "-q"]);
    await mkdir(join(path, "project"));
    await writeFile(join(path, "outside.txt"), "outside\n");
    await writeFile(join(path, "project", "inside.txt"), "inside\n");
    const snapshot = await reader.read(join(path, "project"));
    assert.match(snapshot.diff, /inside\.txt/);
    assert.match(snapshot.diff, /\+inside/);
    assert.doesNotMatch(snapshot.diff, /outside/);
    await writeFile(join(path, "project", "large.txt"), "a".repeat(128_001));
    const large = await reader.read(join(path, "project"));
    assert.equal(large.truncated, true);
    assert.match(large.diff, /too large/);
  } finally { await rm(path, { recursive: true, force: true }); }
});
