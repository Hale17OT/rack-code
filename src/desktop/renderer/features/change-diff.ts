/** Split bounded Git patches into file panels without interpreting code as HTML. */
export interface DiffFile {
  readonly title: string;
  readonly lines: readonly string[];
  readonly added: number;
  readonly removed: number;
}

export function diffFiles(diff: string): DiffFile[] {
  return diff.split(/(?=^diff --git )/m).filter((part) => part.trim() !== "").map((part) => {
    const lines = part.replace(/\n$/, "").split("\n");
    const header = lines[0] ?? "Changes";
    const target = lines.find((line) => line.startsWith("+++ ") && line !== "+++ /dev/null")?.slice(4)
      ?? header.match(/ ("?b\/.*)$/)?.[1];
    let title = target ?? header;
    if (title.startsWith('"')) {
      try { title = JSON.parse(title) as string; } catch { /* Keep Git's escaped path readable. */ }
    }
    title = title.replace(/^b\//, "");
    // Count actual hunk lines, never +++/--- metadata or binary notices.
    let hunk = false;
    let added = 0;
    let removed = 0;
    for (const line of lines) {
      if (line.startsWith("@@")) hunk = true;
      else if (hunk && line.startsWith("+")) added++;
      else if (hunk && line.startsWith("-")) removed++;
    }
    return { title, lines, added, removed };
  });
}
