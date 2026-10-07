import type {
  ChainAccountEntry,
  ClaudeUsageSnapshot,
  ClaudeUsageWindow,
} from "../../../shared/types.js";

export interface AccountSignals {
  limit?: { resetAt: string | null };
  loggedIn?: boolean | null;
}

export type DerivedAccountState = Pick<
  ChainAccountEntry,
  "state" | "limitedUntil"
>;

export const NEAR_LIMIT_PERCENT = 80;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SURFACE_TIME =
  /continu(?:e|ing) automatically at (\d{1,2})(?::(\d{2}))?\s*([ap]m)/gi;

/**
 * Tell whether a read failed to use the token, so the folder login decides the account state.
 */
export function isTokenReadFailed(usage: ClaudeUsageSnapshot): boolean {
  return usage.status === "stale" || usage.status === "unavailable";
}

/**
 * Read the reset time a limit surface prints, as the next such local clock time after `now`.
 *
 * @remarks The CLI prints only a local clock time such as `10:40am`, so a time at or before `now`
 * means the same time tomorrow. The last match wins because the newest surface is lowest in the
 * pane; `shortly` or no surface gives `null`.
 */
export function parseSurfaceResetAt(pane: string, now: Date): string | null {
  const match = [...pane.matchAll(SURFACE_TIME)].at(-1);
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
  const at = new Date(now);
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= now.getTime()) at.setTime(at.getTime() + DAY_MS);
  return at.toISOString();
}

/**
 * Tell whether a limit surface on screen belongs to a reset that has already passed.
 *
 * @remarks The CLI leaves the surface on screen after its reset, and its clock time then parses as
 * tomorrow. The surface is stale when that time passed within the last 5 hours and a good read
 * taken after it shows every bucket below the threshold.
 */
export function isStaleSurface(
  pane: string,
  usage: ClaudeUsageSnapshot,
  thresholdPercent: number,
  now: Date,
): boolean {
  const next = parseSurfaceResetAt(pane, now);
  if (next === null || usage.fetchedAt === null) return false;
  const passed = Date.parse(next) - DAY_MS;
  if (now.getTime() - passed > FIVE_HOURS_MS) return false;
  if (Date.parse(usage.fetchedAt) <= passed) return false;
  const windows = usableWindows(usage);
  return (
    windows.length > 0 && windows.every((w) => w.percent < thresholdPercent)
  );
}

/**
 * Return the windows of the last good read, or none when no good read exists or the token failed.
 *
 * @remarks A 401 or 403 marks the snapshot `stale` and keeps the old windows, but such a read must
 * not set the state, so it gives no windows. A 429 or network error keeps the last good read.
 */
function usableWindows(usage: ClaudeUsageSnapshot): ClaudeUsageWindow[] {
  if (usage.status === "stale" || usage.fetchedAt === null) return [];
  return usage.windows;
}

function latest(times: (string | null)[]): string | null {
  const valid = times.filter((t): t is string => t !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

/**
 * Derive the chain state of one account and its `limitedUntil`.
 *
 * @remarks `limitedUntil` is the latest reset of the buckets at or above the threshold, so a 7 day
 * bucket at the limit holds the account until the 7 day reset even when a shorter bucket is also
 * full. A logged out folder with a rejected or missing token is `login-expired` before any other
 * signal, so the selection never launches on it.
 */
export function deriveAccountState(
  usage: ClaudeUsageSnapshot,
  signals: AccountSignals,
  thresholdPercent: number,
  now: Date,
): DerivedAccountState {
  if (signals.loggedIn === false && isTokenReadFailed(usage)) {
    return { state: "login-expired", limitedUntil: null };
  }
  const windows = usableWindows(usage);
  const full = windows.filter((w) => w.percent >= thresholdPercent);
  if (full.length > 0 || signals.limit) {
    const limitedUntil =
      latest(full.map((w) => w.resetsAt)) ??
      signals.limit?.resetAt ??
      windows.find((w) => w.kind === "session")?.resetsAt ??
      new Date(now.getTime() + FIVE_HOURS_MS).toISOString();
    return { state: "limited", limitedUntil };
  }
  if (windows.length === 0) return { state: "unknown", limitedUntil: null };
  const near = windows.some((w) => w.percent >= NEAR_LIMIT_PERCENT);
  return { state: near ? "near-limit" : "available", limitedUntil: null };
}
