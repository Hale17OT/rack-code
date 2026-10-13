/**
 * Surfaces that can open in the right panel.
 *
 * "Changes" is a core surface and always listed. Plugin surfaces appear in
 * the panel's launcher only when enabled in Settings > Plugins. Every
 * plugin listed here is a preview: enabling it adds a placeholder surface,
 * and none of them has functionality yet. The architecture's optional
 * features (timeline, retrospective, orchestration) and the requested
 * browser and terminal are the planned candidates.
 *
 * Enablement is a renderer preference stored per device. When plugins gain
 * real host-side behavior, the toggle must move to the host so composition
 * can validate dependencies, as the architecture describes for optional
 * features.
 */
import type { IconName } from "./icons.js";

export interface SurfaceDefinition {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  /** Single key that opens the surface while the launcher is visible. */
  readonly shortcut: string;
  readonly kind: "core" | "plugin";
  readonly description: string;
}

export const SURFACES: readonly SurfaceDefinition[] = [
  { id: "changes", title: "Changes", icon: "git-diff", shortcut: "D", kind: "core", description: "Code changes and diffs produced by runs." },
  { id: "terminal", title: "Terminal", icon: "terminal-window", shortcut: "T", kind: "plugin", description: "A terminal presentation of this harness." },
  { id: "browser", title: "Browser", icon: "globe", shortcut: "B", kind: "plugin", description: "A browser shared between you and the agent." },
  { id: "files", title: "Files", icon: "files", shortcut: "F", kind: "plugin", description: "Browse the files of the current workspace." },
  { id: "timeline", title: "Timeline", icon: "clock-counter-clockwise", shortcut: "L", kind: "plugin", description: "Project history across runs and code changes." },
  { id: "retrospective", title: "Retrospective", icon: "lightbulb", shortcut: "R", kind: "plugin", description: "Post-run analysis and environment observations." },
  { id: "orchestration", title: "Orchestration", icon: "flow-arrow", shortcut: "O", kind: "plugin", description: "Multi-stage workflows across models and providers." },
];

const STORAGE_KEY = "plugins.enabled";

export function loadEnabledPlugins(): readonly string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    const known = new Set(SURFACES.filter((surface) => surface.kind === "plugin").map((surface) => surface.id));
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && known.has(id)) : [];
  } catch {
    return [];
  }
}

export function saveEnabledPlugins(ids: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // A lost preference only hides plugin surfaces again.
  }
}
