/**
 * Recursive filesystem watcher for Timeline's live observations.
 *
 * Uses Node's `fs.watch(..., { recursive: true })`, which is native on macOS
 * and Windows and supported on Linux by recent Node releases (including
 * Electron's embedded Node). When recursive watching is unavailable, `watch`
 * returns `undefined` and Timeline falls back to tool and run boundaries.
 *
 * Events inside `.git` are dropped. Timeline's own capture writes objects and
 * updates a ref there; reacting to those writes would schedule an endless
 * series of identical observations. Event bursts are not coalesced here;
 * `RunRecorder` debounces and coalesces them.
 */
import { watch, type FSWatcher } from "node:fs";

import type { ProjectWatcher, WatchHandle } from "../../features/timeline/index.js";

export class NodeProjectWatcher implements ProjectWatcher {
  watch(repositoryRoot: string, onChange: () => void): WatchHandle | undefined {
    let watcher: FSWatcher;
    try {
      watcher = watch(repositoryRoot, { recursive: true, persistent: false }, (_event, filename) => {
        // A missing filename means the platform could not say what changed;
        // treat it as a change rather than miss an edit.
        if (filename !== null && isInsideGitDirectory(String(filename))) return;
        onChange();
      });
    } catch {
      return undefined;
    }
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      watcher.close();
    };
    // Errors (for example a deleted root) end live observation for this run.
    watcher.on("error", close);
    return { close, get closed() { return closed; } };
  }
}

function isInsideGitDirectory(filename: string): boolean {
  return filename.split(/[\\/]/).includes(".git");
}
