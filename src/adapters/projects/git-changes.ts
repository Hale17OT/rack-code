import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { ProjectChangesReader } from "../../core/projects/ports.js";
import type { ProjectChanges } from "../../core/projects/types.js";
import { GitRepositoryDiscovery, repositoryScope } from "./git-repositories.js";

const execute = promisify(execFile);
const MAX_DIFF = 1_000_000;
const MAX_NEW_FILE = 128_000;

/**
 * Reads staged/unstaged changes against HEAD and previews untracked text.
 * Git runs without a shell, external diff drivers or text conversions. Reads
 * are bounded and never stage, reset or modify files. A snapshot can race an
 * editor; periodic refresh supplies the next current view.
 */
export class GitProjectChangesReader implements ProjectChangesReader {
  private readonly repositories = new GitRepositoryDiscovery();

  discover(path: string, options: import("../../core/projects/types.js").RepositoryDiscoveryOptions) {
    return this.repositories.discover(path, options);
  }

  /** Revalidate containment on every read; cached discoveries cannot authorize moved paths. */
  async readRepository(path: string, repositoryPath: string): Promise<ProjectChanges> {
    return this.read(await repositoryScope(path, repositoryPath));
  }

  async read(path: string): Promise<ProjectChanges> {
    const git = async (args: string[]): Promise<string> => (await execute("git", ["-C", path, ...args], {
      encoding: "utf8", timeout: 5000, maxBuffer: 2_000_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    })).stdout;
    try {
      if ((await git(["rev-parse", "--is-inside-work-tree"])).trim() !== "true") {
        return { status: "not_git", diff: "", truncated: false };
      }
    } catch (error) {
      // Missing Git and permission failures must not be reported as a clean tree.
      if (String((error as { stderr?: string }).stderr).includes("not a git repository")) {
        return { status: "not_git", diff: "", truncated: false };
      }
      throw error;
    }
    const flags = ["--no-ext-diff", "--no-textconv", "--no-color"];
    let hasHead = true;
    try { await git(["rev-parse", "--verify", "HEAD"]); } catch { hasHead = false; }
    let diff = hasHead
      ? await git(["diff", ...flags, "HEAD", "--", "."])
      : await git(["diff", ...flags, "--cached", "--", "."]) + await git(["diff", ...flags, "--", "."]);
    const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z", "--", "."])).split("\0").filter(Boolean);
    let truncated = diff.length > MAX_DIFF || untracked.length > 50;
    for (const name of untracked.slice(0, 50)) {
      if (diff.length >= MAX_DIFF) { truncated = true; break; }
      const fullPath = resolve(path, name);
      const local = relative(path, fullPath);
      if (isAbsolute(local) || local === ".." || local.startsWith("../")) continue;
      // Do not follow untracked symlinks out of the selected project.
      let info;
      try { info = await lstat(fullPath); } catch { continue; }
      if (!info.isFile()) continue;
      const header = `diff --git ${JSON.stringify(`a/${name}`)} ${JSON.stringify(`b/${name}`)}\nnew file mode 100644\n`;
      if (info.size > MAX_NEW_FILE) { diff += `${header}File too large to preview\n`; truncated = true; continue; }
      let content: Buffer;
      try {
        // Bound the actual read as well as the stat: an active tool may grow
        // or replace this file between the two operations.
        const file = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const buffer = Buffer.alloc(MAX_NEW_FILE + 1);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          if (bytesRead > MAX_NEW_FILE) { diff += `${header}File too large to preview\n`; truncated = true; continue; }
          content = buffer.subarray(0, bytesRead);
        } finally { await file.close(); }
      } catch { continue; }
      if (content.includes(0)) { diff += `${header}Binary file\n`; continue; }
      const text = content.toString("utf8");
      const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
      diff += `${header}--- /dev/null\n+++ ${JSON.stringify(`b/${name}`)}\n`;
      if (lines.length) diff += `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n`;
      if (text !== "" && !text.endsWith("\n")) diff += "\\ No newline at end of file\n";
    }
    return { status: "ready", diff: diff.slice(0, MAX_DIFF), truncated: truncated || diff.length > MAX_DIFF };
  }
}
