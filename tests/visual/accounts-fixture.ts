import type { Page } from "@playwright/test";
import type {
  ChainView,
  ClaudeAccountSummary,
  ClaudeUsageSnapshot,
  ClaudeUsageWindow,
} from "../../src/shared/types.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const iso = (ms: number) => new Date(ms).toISOString();

const usageWindow = (
  kind: string,
  label: string,
  percent: number,
  start: number,
  end: number,
): ClaudeUsageWindow => ({
  kind,
  label,
  percent,
  resetsAt: iso(end),
  isActive: true,
  periodStart: iso(start),
  periodEnd: iso(end),
});

const okUsage = (
  now: number,
  session: number,
  weekly: number,
): ClaudeUsageSnapshot => ({
  status: "ok",
  fetchedAt: iso(now - MINUTE),
  windows: [
    usageWindow("session", "Session", session, now - 2 * HOUR, now + 3 * HOUR),
    usageWindow("weekly_all", "Weekly", weekly, now - 3 * DAY, now + 4 * DAY),
  ],
});

export function accountsBody(now: number, count = 3) {
  const base = {
    orgName: "",
    subscriptionType: "",
    isDefault: false,
    buckets: [],
  };
  const active = okUsage(now, 31, 48);
  active.windows.push(
    usageWindow(
      "weekly_scoped",
      "Weekly Opus",
      12,
      now - 3 * DAY,
      now + 4 * DAY,
    ),
  );
  const accounts: ClaudeAccountSummary[] = [
    {
      ...base,
      id: "a1",
      email: "active.person@example.com",
      isDefault: true,
      usage: active,
      position: 0,
      state: "available",
      limitedUntil: null,
      inUse: true,
    },
    {
      ...base,
      id: "a2",
      email: "limited.person@example.com",
      usage: okUsage(now, 100, 72),
      position: 1,
      state: "limited",
      limitedUntil: iso(now + 100 * MINUTE),
      inUse: false,
    },
    {
      ...base,
      id: "a3",
      email: "expired.person@example.com",
      usage: { status: "unavailable", windows: [], fetchedAt: null },
      position: 2,
      state: "login-expired",
      limitedUntil: null,
      inUse: false,
    },
  ];
  const chain: ChainView = {
    settings: {
      autoMove: false,
      thresholdPercent: 100,
      minDwellMinutes: 15,
      hysteresisPercent: 10,
    },
    exhausted: null,
    history: [],
    inUseSince: null,
  };
  return {
    activeId: "a1",
    accounts: accounts.slice(0, count),
    sessions: [],
    chain,
  };
}

/**
 * Serve GET /api/accounts from `accountsBody` and pass every other method through.
 */
export function mockAccounts(page: Page, now: number, count = 3) {
  return page.route("**/api/accounts", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: accountsBody(now, count) })
      : route.fallback(),
  );
}
