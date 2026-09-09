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

export const PACE_ON_TRACK_MAX = 1;
export const PACE_AHEAD_MAX = 1.25;
const MIN_ELAPSED_PERCENT = 1;

export type PaceState = "on-track" | "ahead" | "will-run-out";

export const PACE_BADGE: Record<
  PaceState,
  { label: string; tone: UsageTone; text: string }
> = {
  "on-track": { label: "On track", tone: "ok", text: "var(--status-ok)" },
  ahead: {
    label: "Ahead of budget",
    tone: "stale",
    text: "var(--status-stale)",
  },
  "will-run-out": {
    label: "Will run out",
    tone: "down",
    text: "var(--destructive-text)",
  },
};

export interface Pacing {
  percentElapsed: number;
  elapsedMs: number;
  state: PaceState;
  exhaustsAt: number | null;
  capped: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The instant a snapshot's percentages were measured, the only honest anchor for elapsed time.
 *
 * @remarks Null for any snapshot that is not `ok`, so stale windows never grow a pace that drifts
 * optimistic as the data ages.
 */
export function pacedAtFor(usage: ClaudeUsageSnapshot): number | null {
  if (usage.status !== "ok" || !usage.fetchedAt) return null;
  const at = Date.parse(usage.fetchedAt);
  return Number.isNaN(at) ? null : at;
}

/**
 * Compare a window's used percent with the share of its period elapsed at `now`.
 *
 * @remarks Exhaustion is a linear projection from the period start, capped at the period end.
 * Under 1% elapsed there is no projection and the state is On track, so a fresh period never
 * reads as a problem; a fully used window is always Will run out whatever the ratio says.
 * @returns Null when the window has no usable period or its period has already ended.
 */
export function pacingFor(
  usageWindow: ClaudeUsageWindow,
  now: number = Date.now(),
): Pacing | null {
  if (!usageWindow.periodStart || !usageWindow.periodEnd) return null;
  const start = Date.parse(usageWindow.periodStart);
  const end = Date.parse(usageWindow.periodEnd);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    Number.isNaN(now) ||
    end <= start ||
    now >= end
  ) {
    return null;
  }
  const elapsedMs = Math.max(0, now - start);
  const percentElapsed = (elapsedMs / (end - start)) * 100;
  if (percentElapsed < MIN_ELAPSED_PERCENT) {
    return {
      percentElapsed,
      elapsedMs,
      state: "on-track",
      exhaustsAt: null,
      capped: false,
    };
  }
  const used = usageWindow.percent;
  const pace = used / percentElapsed;
  const projected = used === 0 ? end : start + (elapsedMs * 100) / used;
  const capped = projected >= end;
  return {
    percentElapsed,
    elapsedMs,
    state:
      used >= 100 || pace > PACE_AHEAD_MAX
        ? "will-run-out"
        : pace <= PACE_ON_TRACK_MAX
          ? "on-track"
          : "ahead",
    exhaustsAt: capped ? end : projected,
    capped,
  };
}

/**
 * The one projection line under a bar.
 *
 * @remarks A date for the spend budget, a countdown for rolling windows, the "lasts" variant
 * when the projection is capped at the period end, and a plain "reached" line at 100% used.
 * @returns Null when there is no projection (under 1% elapsed).
 */
export function projectionCopy(
  usageWindow: ClaudeUsageWindow,
  pacing: Pacing,
  now: number = Date.now(),
): string | null {
  if (pacing.exhaustsAt === null) return null;
  const spend = usageWindow.kind === "spend";
  if (usageWindow.percent >= 100) {
    return spend ? "Credit used up" : "Limit reached";
  }
  if (pacing.capped) {
    return spend
      ? "At this rate, credit lasts the month"
      : "At this rate, limit holds until reset";
  }
  if (spend) {
    const date = new Date(pacing.exhaustsAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `At this rate, credit runs out on ${date}`;
  }
  const countdown = formatReset(new Date(pacing.exhaustsAt).toISOString(), now);
  return countdown === "soon"
    ? "At this rate, limit hits soon"
    : `At this rate, limit hits in ${countdown}`;
}

/**
 * The raw numbers behind a badge: used, elapsed, and burn rate per hour (session) or per day.
 */
export function paceTitle(
  usageWindow: ClaudeUsageWindow,
  pacing: Pacing,
): string {
  const parts = [
    `Used ${usageWindow.percent}%`,
    `Elapsed ${Math.round(pacing.percentElapsed)}%`,
  ];
  if (pacing.elapsedMs > 0) {
    const perDay = usageWindow.kind !== "session";
    const rate =
      (usageWindow.percent / pacing.elapsedMs) * (perDay ? DAY_MS : HOUR_MS);
    parts.push(`${rate.toFixed(1)}%/${perDay ? "day" : "hour"}`);
  }
  return parts.join(" · ");
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
