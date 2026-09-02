import type {
  ClaudeUsageSnapshot,
  ClaudeUsageWindow,
} from "../../../shared/types.js";

export type UsageTone = "ok" | "stale" | "down";

const KIND_ORDER: Record<string, number> = {
  session: 0,
  weekly_all: 1,
  weekly_scoped: 2,
};

/**
 * The window closest to its limit: highest percent, session first on ties, so the chip always
 * names the number that will bite first.
 */
export function tightestWindow(
  windows: ClaudeUsageWindow[],
): ClaudeUsageWindow | null {
  let best: ClaudeUsageWindow | null = null;
  for (const w of windows) {
    if (
      best === null ||
      w.percent > best.percent ||
      (w.percent === best.percent &&
        (KIND_ORDER[w.kind] ?? 9) < (KIND_ORDER[best.kind] ?? 9))
    ) {
      best = w;
    }
  }
  return best;
}

/**
 * Colour tone for a percent: under 70 calm, 70 to 89 warning, 90 and above critical.
 */
export function toneFor(percent: number): UsageTone {
  if (percent >= 90) return "down";
  if (percent >= 70) return "stale";
  return "ok";
}

/**
 * The CSS token a tone maps to.
 */
export function toneColor(tone: UsageTone): string {
  return `var(--status-${tone})`;
}

/**
 * Human countdown to a reset instant: "2h 10m", "3d 4h", "45m", or "soon" once it has passed.
 * Returns null when the reset time is unknown.
 */
export function formatReset(
  resetsAt: string | null,
  now: number = Date.now(),
): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (Number.isNaN(at)) return null;
  const ms = at - now;
  if (ms <= 0) return "soon";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ${hours % 24}h`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}

/**
 * The part of an email before the at sign, the chip's short account name.
 */
export function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

/**
 * The one line of copy for a usage snapshot that is not plain numbers; null when it is `ok`.
 */
export function statusCopy(usage: ClaudeUsageSnapshot): string | null {
  switch (usage.status) {
    case "ok":
      return null;
    case "stale":
      return "Usage stale, refreshes on the next session";
    case "unavailable":
      return "Usage unavailable, sign in to see it";
    case "rate-limited":
      return "Usage rate limited, try again later";
    case "error":
      return "Usage could not be fetched";
  }
}
