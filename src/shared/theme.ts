export const THEME_STORAGE_KEY = "dsp.theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type Theme = "light" | "dark";

export const LIGHT_SCHEME_QUERY = "(prefers-color-scheme: light)";

/**
 * Reads a stored theme preference.
 *
 * @remarks Any value outside the closed set means "system", so a garbage or absent value never
 * reaches the html element. The pre-paint script in both html shells applies the same rule.
 * @see docs/ARCHITECTURE.md#theme-engine
 */
export function parseThemePreference(raw: unknown): ThemePreference {
  return THEME_PREFERENCES.find((value) => value === raw) ?? "system";
}

/**
 * Resolves the theme to paint from the preference and the system scheme.
 *
 * @see docs/ARCHITECTURE.md#theme-engine
 */
export function resolveTheme(
  preference: ThemePreference,
  systemIsLight: boolean,
): Theme {
  if (preference === "system") return systemIsLight ? "light" : "dark";
  return preference;
}
