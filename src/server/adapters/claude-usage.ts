import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClaudeUsageWindow } from "../../shared/types.js";
import { run } from "./exec.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USAGE_TIMEOUT_MS = 10_000;
const MAX_DATE_MS = 8.64e15;
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_LENGTH_MS: Record<string, number> = {
  session: 5 * HOUR_MS,
  weekly_all: 7 * 24 * HOUR_MS,
  weekly_scoped: 7 * 24 * HOUR_MS,
};

export interface UsageFetchResult {
  status: number;
  retryAfterMs: number | null;
  body: unknown;
}

export interface ClaudeCredential {
  token: string;
  loginExpiresAt: string | null;
  accessExpiresAt?: number;
}

/**
 * Tell whether a credential field is a positive epoch ms number a `Date` can hold.
 */
function validEpochMs(value: unknown): value is number {
  return typeof value === "number" && value > 0 && value <= MAX_DATE_MS;
}

/**
 * Parse a credential text into the OAuth access token, the login expiry as an ISO string and the
 * access token expiry in epoch ms.
 *
 * @remarks The login expiry is the refresh token's `refreshTokenExpiresAt`; anything but a finite
 * positive number reads as unknown (`null`). `accessExpiresAt` is the access token's `expiresAt`,
 * omitted when invalid, and it stays in memory only.
 */
export function parseCredential(raw: string): ClaudeCredential | null {
  try {
    const parsed = JSON.parse(raw.trim()) as {
      claudeAiOauth?: {
        accessToken?: unknown;
        expiresAt?: unknown;
        refreshTokenExpiresAt?: unknown;
      };
    };
    const oauth = parsed?.claudeAiOauth;
    const token = oauth?.accessToken;
    if (typeof token !== "string" || token.length === 0) return null;
    const ms = oauth?.refreshTokenExpiresAt;
    const loginExpiresAt = validEpochMs(ms) ? new Date(ms).toISOString() : null;
    const accessExpiresAt = oauth?.expiresAt;
    return validEpochMs(accessExpiresAt)
      ? { token, loginExpiresAt, accessExpiresAt }
      : { token, loginExpiresAt };
  } catch {
    return null;
  }
}

/**
 * Read an account's OAuth token and login expiry into memory.
 *
 * @remarks Sources in order: the macOS keychain item for the service (with the OS username, then
 * without, since Claude Code substitutes a fixed name for unusual usernames), then the config dir's
 * credentials file. Both values come from the first source that holds a token, and the token is
 * never logged.
 */
export async function readCredential(
  keychainService: string,
  configDir: string,
): Promise<ClaudeCredential | null> {
  if (process.platform === "darwin") {
    const attempts = [
      ["-s", keychainService, "-a", os.userInfo().username, "-w"],
      ["-s", keychainService, "-w"],
    ];
    for (const args of attempts) {
      try {
        const { stdout } = await run(
          "security",
          ["find-generic-password", ...args],
          { timeout: 5_000 },
        );
        const credential = parseCredential(stdout);
        if (credential) return credential;
      } catch {}
    }
  }
  try {
    const raw = await fsp.readFile(
      path.join(configDir, ".credentials.json"),
      "utf8",
    );
    return parseCredential(raw);
  } catch {
    return null;
  }
}

/**
 * Call the OAuth usage endpoint with a bearer token. Resolves for every HTTP status (the caller
 * classifies); rejects only on network failure or timeout.
 */
export async function fetchUsage(
  token: string,
  userAgent: string,
): Promise<UsageFetchResult> {
  const res = await fetch(process.env.DISPATCH_USAGE_URL || USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": userAgent,
    },
    signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
  });
  const retryAfter = res.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return {
    status: res.status,
    retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : null,
    body,
  };
}

function clampPercent(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

function toIso(raw: unknown): string | null {
  if (typeof raw === "string" && raw !== "") {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw < 1e10 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  return null;
}

type Period = Pick<ClaudeUsageWindow, "periodStart" | "periodEnd">;

/**
 * The period a rolling window covers, its known length back from the reset instant.
 *
 * @remarks The API reports only the reset, so an unknown kind or a missing reset yields no
 * period rather than a guessed one.
 */
function periodFor(kind: string, resetsAt: string | null): Period {
  const length = WINDOW_LENGTH_MS[kind];
  if (length === undefined || resetsAt === null) {
    return { periodStart: null, periodEnd: null };
  }
  return {
    periodStart: new Date(Date.parse(resetsAt) - length).toISOString(),
    periodEnd: resetsAt,
  };
}

/**
 * The local calendar month around `now`, used as the spend budget's period because the API
 * returns no billing boundaries for it.
 */
function monthPeriod(now: Date): Period {
  return {
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
  };
}

interface RawLimit {
  kind?: unknown;
  percent?: unknown;
  resets_at?: unknown;
  is_active?: unknown;
  scope?: { model?: { display_name?: unknown } | null } | null;
}

interface RawBucket {
  utilization?: unknown;
  resets_at?: unknown;
}

interface RawSpend {
  percent?: unknown;
  enabled?: unknown;
}

/**
 * Map the `spend` block to a single usage window, or null when spend tracking is off.
 *
 * @remarks Enterprise and team seats have no per-account rate-limit windows (`limits` is empty and
 * the legacy buckets are null); their usage is a monthly credit budget reported under `spend`.
 * Without this the endpoint's 200 yields zero windows and the UI mislabels it as stale.
 */
function mapSpendWindow(spend: unknown, now: Date): ClaudeUsageWindow | null {
  const s = (spend ?? {}) as RawSpend;
  if (s.enabled !== true) return null;
  const percent = clampPercent(s.percent);
  if (percent === null) return null;
  return {
    kind: "spend",
    label: "Usage credits",
    percent,
    resetsAt: null,
    isActive: true,
    ...monthPeriod(now),
  };
}

function labelFor(kind: string, limit: RawLimit): string {
  if (kind === "session") return "Session";
  if (kind === "weekly_all") return "Weekly";
  const model = limit.scope?.model?.display_name;
  if (kind === "weekly_scoped" && typeof model === "string" && model !== "") {
    return `Weekly ${model}`;
  }
  return kind.replace(/_/g, " ");
}

/**
 * Map a usage endpoint payload to the wire windows: the `limits` array when present, else the
 * legacy `five_hour` and `seven_day` buckets, else the enterprise `spend` credit budget. Unknown
 * kinds are kept with a humanised label so a new limit type shows up instead of vanishing.
 */
export function mapUsageResponse(
  body: unknown,
  now: Date = new Date(),
): ClaudeUsageWindow[] {
  const root = (body ?? {}) as {
    limits?: unknown;
    five_hour?: RawBucket | null;
    seven_day?: RawBucket | null;
    spend?: unknown;
  };
  if (Array.isArray(root.limits) && root.limits.length > 0) {
    const out: ClaudeUsageWindow[] = [];
    for (const entry of root.limits as RawLimit[]) {
      const kind = typeof entry?.kind === "string" ? entry.kind : "";
      const percent = clampPercent(entry?.percent);
      if (kind === "" || percent === null) continue;
      const resetsAt = toIso(entry.resets_at);
      out.push({
        kind,
        label: labelFor(kind, entry),
        percent,
        resetsAt,
        isActive: entry.is_active === true,
        ...periodFor(kind, resetsAt),
      });
    }
    if (out.length > 0) return out;
  }
  const out: ClaudeUsageWindow[] = [];
  const buckets: [string, string, RawBucket | null | undefined][] = [
    ["session", "Session", root.five_hour],
    ["weekly_all", "Weekly", root.seven_day],
  ];
  for (const [kind, label, bucket] of buckets) {
    const percent = clampPercent(bucket?.utilization);
    if (percent === null) continue;
    const resetsAt = toIso(bucket?.resets_at);
    out.push({
      kind,
      label,
      percent,
      resetsAt,
      isActive: true,
      ...periodFor(kind, resetsAt),
    });
  }
  if (out.length === 0) {
    const spend = mapSpendWindow(root.spend, now);
    if (spend) out.push(spend);
  }
  return out;
}
