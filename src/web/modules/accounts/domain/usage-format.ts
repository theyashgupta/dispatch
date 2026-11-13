import { LOGIN_EXPIRY_WARN_MS } from "../../../../shared/account-chain.js";
import type {
  ClaudeAccountSummary,
  ClaudeUsageSnapshot,
  ClaudeUsageWindow,
} from "../../../../shared/types.js";
import {
  DEFAULT_USAGE_THRESHOLDS,
  toneForPercent,
  type UsageThresholds,
  type UsageTone,
} from "../../../../shared/usage-thresholds.js";

export type { UsageTone };

const KIND_ORDER: Record<string, number> = {
  session: 0,
  weekly_all: 1,
  weekly_scoped: 2,
};

/**
 * Pick the window closest to its limit: highest percent, session first on ties, so the chip always
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
 * Map a percent to a colour tone: calm below the warning percent, warning below critical, critical from there.
 */
export function toneFor(
  percent: number,
  thresholds: UsageThresholds = DEFAULT_USAGE_THRESHOLDS,
): UsageTone {
  return toneForPercent(percent, thresholds);
}

/**
 * Format a human countdown to a reset instant: "2h 10m", "3d 4h", "45m", or "soon" once it has passed.
 * Return null when the reset time is unknown.
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

const PACE_ON_TRACK_MAX = 1;
const PACE_AHEAD_MAX = 1.25;
const MIN_ELAPSED_PERCENT = 1;

export type PaceState = "on-track" | "ahead" | "will-run-out";

export const PACE_BADGE: Record<PaceState, { label: string; tone: UsageTone }> =
  {
    "on-track": { label: "On track", tone: "ok" },
    ahead: { label: "Ahead of budget", tone: "stale" },
    "will-run-out": { label: "Will run out", tone: "down" },
  };

export interface Pacing {
  percentElapsed: number;
  elapsedMs: number;
  state: PaceState;
  exhaustsAt: number | null;
  capped: boolean;
}

/**
 * Return the instant a snapshot's percentages were measured, the only honest anchor for elapsed time.
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
 * Return the one line of copy for a usage snapshot that is not plain numbers, or null when it is `ok`.
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

/**
 * Build the Accounts page's one usage line: every window with its percent and reset, or the status copy.
 */
export function usageLine(
  usage: ClaudeUsageSnapshot,
  now: number = Date.now(),
): string {
  const copy = statusCopy(usage);
  if (copy !== null || usage.windows.length === 0) {
    return copy ?? "Usage unavailable, sign in to see it";
  }
  return usage.windows
    .map((w) => {
      const reset = formatReset(w.resetsAt, now);
      return `${w.label} ${w.percent}%${reset ? ` (resets ${reset})` : ""}`;
    })
    .join(" · ");
}

export interface ChipState {
  tone: UsageTone | "muted";
  summary: string;
  label: string;
}

/**
 * Compute what the header chip shows for the active account: the tightest window's percent, or the status copy.
 */
export function chipState(
  usage: ClaudeUsageSnapshot,
  thresholds: UsageThresholds = DEFAULT_USAGE_THRESHOLDS,
  now: number = Date.now(),
): ChipState {
  const tightest = usage.status === "ok" ? tightestWindow(usage.windows) : null;
  if (tightest === null) {
    const summary = statusCopy(usage) ?? "usage stale";
    return {
      tone: usage.status === "unavailable" ? "muted" : "stale",
      summary,
      label: summary,
    };
  }
  const reset = formatReset(tightest.resetsAt, now);
  return {
    tone: toneFor(tightest.percent, thresholds),
    summary: `${tightest.percent}% used${reset ? `, resets ${reset}` : ""}`,
    label: `${tightest.percent}%`,
  };
}

const PACE_SEVERITY: Record<PaceState, number> = {
  "on-track": 0,
  ahead: 1,
  "will-run-out": 2,
};

const CLOCK_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

/**
 * Pick the one status line under the popover bars: login, limit, usage status, then worst pace.
 *
 * @remarks A limit set by the user's threshold says so, because Claude itself would still accept work.
 *
 * @returns Null when there is nothing to say.
 */
export function accountStateLine(
  account: ClaudeAccountSummary,
  now: number = Date.now(),
): { text: string; tone: UsageTone | "muted" } | null {
  const { usage } = account;
  const loginAt = usage.loginExpiresAt ? Date.parse(usage.loginExpiresAt) : NaN;
  if (
    account.state === "login-expired" ||
    account.state === "needs-login" ||
    loginAt < now
  ) {
    return { text: "Login expired, sign in again", tone: "down" };
  }
  if (account.state === "limited") {
    const limited =
      account.limitSource === "threshold"
        ? "Limited by your threshold"
        : "Limited";
    const at = account.limitedUntil ? Date.parse(account.limitedUntil) : NaN;
    if (Number.isNaN(at) || at <= now) return { text: limited, tone: "down" };
    const clock =
      new Date(at).toDateString() !== new Date(now).toDateString()
        ? new Date(at).toLocaleString(undefined, {
            weekday: "short",
            ...CLOCK_FORMAT,
          })
        : new Date(at).toLocaleTimeString(undefined, CLOCK_FORMAT);
    return { text: `${limited} until ${clock}`, tone: "down" };
  }
  const copy = statusCopy(usage);
  if (copy !== null) {
    return {
      text: copy,
      tone: usage.status === "unavailable" ? "muted" : "stale",
    };
  }
  const pacedAt = pacedAtFor(usage);
  if (pacedAt !== null) {
    let worst: PaceState | null = null;
    for (const w of usage.windows) {
      const state = pacingFor(w, pacedAt)?.state;
      if (
        state !== undefined &&
        (worst === null || PACE_SEVERITY[state] > PACE_SEVERITY[worst])
      ) {
        worst = state;
      }
    }
    if (worst !== null) {
      return { text: PACE_BADGE[worst].label, tone: PACE_BADGE[worst].tone };
    }
  }
  const fetchedAt = usage.fetchedAt ? Date.parse(usage.fetchedAt) : NaN;
  if (Number.isNaN(fetchedAt)) return null;
  return {
    text: `Checked ${new Date(fetchedAt).toLocaleTimeString(undefined, CLOCK_FORMAT)}`,
    tone: "muted",
  };
}

interface LoginExpiryView {
  text: string;
  tone: "warning" | "neutral";
}

/**
 * Describe when an account's login expires, warning once it is 3 days away or past.
 *
 * @returns Null when the expiry is absent or not a date.
 */
export function loginExpiryView(
  loginExpiresAt: string | undefined,
  now: number,
): LoginExpiryView | null {
  if (!loginExpiresAt) return null;
  const at = Date.parse(loginExpiresAt);
  if (Number.isNaN(at)) return null;
  const date = new Date(at).toLocaleDateString();
  if (at < now) return { text: `Login expired ${date}`, tone: "warning" };
  return {
    text: `Login expires ${date}`,
    tone: at - now <= LOGIN_EXPIRY_WARN_MS ? "warning" : "neutral",
  };
}
