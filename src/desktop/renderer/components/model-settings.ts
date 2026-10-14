/**
 * Catalog-driven selections for the unified model dropdown. Provider IDs are
 * opaque; adapters supply speed semantics and reasoning stops stay in the
 * provider's order. Unsupported saved choices fall back to model defaults.
 */
import type { ModelView } from "../../../contracts/desktop/index.js";

export const PROVIDER_DEFAULT = "__default__";
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max",
};

export interface EffortStop {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export function modelKey(model: ModelView): string {
  return `${model.providerId}|${model.runtimeId}|${model.id}`;
}

/** A synthetic Default stop is needed only when the provider reports no valid default. */
export function effortStops(model: ModelView): readonly EffortStop[] {
  const levels = model.reasoningEfforts ?? [];
  if (levels.length === 0) return [];
  return [
    ...(levels.some((level) => level.id === model.defaultReasoningEffort) ? [] : [{ id: PROVIDER_DEFAULT, label: "Default" }]),
    ...levels.map((level) => ({ ...level, label: EFFORT_LABELS[level.id] ?? level.id })),
  ];
}

export function selectedEffort(model: ModelView, preferred: string | undefined): string | undefined {
  const stops = effortStops(model);
  if (stops.length === 0) return undefined;
  if (stops.some((stop) => stop.id === preferred)) return preferred;
  return stops.some((stop) => stop.id === model.defaultReasoningEffort) ? model.defaultReasoningEffort : PROVIDER_DEFAULT;
}

/** A Fast toggle is available only when adapters report both on and off options. */
export function fastOptions(model: ModelView) {
  const standard = model.speeds?.find((option) => option.fast === false);
  const fast = model.speeds?.find((option) => option.fast === true);
  return standard === undefined || fast === undefined ? undefined : { standard, fast };
}

export function selectedSpeed(model: ModelView, preferredFast: boolean | undefined, legacySpeed?: string): string | undefined {
  const options = fastOptions(model);
  if (options === undefined) return undefined;
  const preferred = preferredFast ?? model.speeds?.find((option) => option.id === legacySpeed)?.fast;
  if (preferred !== undefined) return preferred ? options.fast.id : options.standard.id;
  return model.defaultSpeed === options.fast.id ? options.fast.id : options.standard.id;
}
