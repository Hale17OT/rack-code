/**
 * Light, dark, and system appearance.
 *
 * The preference is a per-device renderer convenience, so it lives in
 * `localStorage` rather than in host records. `system` defers to the OS via
 * the `prefers-color-scheme` media query in styles.css; `light` and `dark`
 * pin the palette by setting `data-theme` on the root element.
 */
export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "appearance";

export function loadTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset["theme"] = preference;
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
}
