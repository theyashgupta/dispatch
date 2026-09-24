export const SOURCE_ACCENT: Record<string, string> = {
  github: "var(--src-github)",
  linear: "var(--src-linear)",
  slack: "var(--src-slack)",
  sentry: "var(--src-sentry)",
  meeting: "var(--src-meeting)",
  calendar: "var(--src-calendar)",
  agent: "var(--src-agent)",
  local: "var(--text-muted)",
  group: "var(--text-muted)",
};

const NEUTRAL_ACCENT = "var(--text-muted)";

/**
 * Resolves a card source id to its badge color token, falling back to the neutral token for ids
 * the plan does not name.
 * @remarks `NEW-24` fences this map as the only place under `src/web` that may reference a
 * `--src-*` token, and requires every entry to name a token declared in `tokens.css`.
 */
export function sourceAccent(source: string): string {
  return Object.hasOwn(SOURCE_ACCENT, source)
    ? SOURCE_ACCENT[source]
    : NEUTRAL_ACCENT;
}
