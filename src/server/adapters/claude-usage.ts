import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClaudeUsageWindow } from "../../shared/types.js";
import { run } from "./exec.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USAGE_TIMEOUT_MS = 10_000;

export interface UsageFetchResult {
  status: number;
  retryAfterMs: number | null;
  body: unknown;
}

function parseAccessToken(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw.trim()) as {
      claudeAiOauth?: { accessToken?: unknown };
    };
    const token = parsed?.claudeAiOauth?.accessToken;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Read an account's OAuth access token into memory: the macOS keychain item for the given service
 * (with the OS username, then without, since Claude Code substitutes a fixed name for unusual
 * usernames), then the config dir's credentials file. The value is returned to exactly one caller
 * and never logged.
 */
export async function readAccessToken(
  keychainService: string,
  configDir: string,
): Promise<string | null> {
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
        const token = parseAccessToken(stdout);
        if (token) return token;
      } catch {}
    }
  }
  try {
    const raw = await fsp.readFile(
      path.join(configDir, ".credentials.json"),
      "utf8",
    );
    return parseAccessToken(raw);
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
  const res = await fetch(USAGE_URL, {
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
function mapSpendWindow(spend: unknown): ClaudeUsageWindow | null {
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
export function mapUsageResponse(body: unknown): ClaudeUsageWindow[] {
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
      out.push({
        kind,
        label: labelFor(kind, entry),
        percent,
        resetsAt: toIso(entry.resets_at),
        isActive: entry.is_active === true,
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
    out.push({
      kind,
      label,
      percent,
      resetsAt: toIso(bucket?.resets_at),
      isActive: true,
    });
  }
  if (out.length === 0) {
    const spend = mapSpendWindow(root.spend);
    if (spend) out.push(spend);
  }
  return out;
}
