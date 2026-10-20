import test from "node:test";
import assert from "node:assert/strict";
import type {
  ClaudeAccountSummary,
  ClaudeUsageSnapshot,
} from "../../../../shared/types.js";
import {
  accountStateLine,
  chipState,
  findWindow,
  formatReset,
  loginExpiryView,
  PACE_BADGE,
  pacedAtFor,
  pacingFor,
  popoverWindows,
  statusCopy,
  tightestWindow,
  toneFor,
  usageLine,
} from "./usage-format.js";

const w = (kind: string, percent: number) => ({
  kind,
  label: kind,
  percent,
  resetsAt: null,
  isActive: true,
  periodStart: null,
  periodEnd: null,
});

void test("tightestWindow picks the highest percent, session first on ties, null when empty", () => {
  assert.equal(tightestWindow([])?.kind, undefined);
  assert.equal(
    tightestWindow([
      w("weekly_all", 40),
      w("session", 55),
      w("weekly_scoped", 12),
    ])?.kind,
    "session",
  );
  assert.equal(
    tightestWindow([w("weekly_scoped", 55), w("session", 55)])?.kind,
    "session",
  );
  assert.equal(
    tightestWindow([w("weekly_scoped", 90), w("session", 55)])?.kind,
    "weekly_scoped",
  );
});

void test("toneFor thresholds at 70 and 90", () => {
  assert.equal(toneFor(0), "ok");
  assert.equal(toneFor(69), "ok");
  assert.equal(toneFor(70), "stale");
  assert.equal(toneFor(89), "stale");
  assert.equal(toneFor(90), "down");
  assert.equal(toneFor(100), "down");
});

void test("formatReset renders days, hours, minutes, soon, and null", () => {
  const now = Date.parse("2026-09-02T00:00:00Z");
  assert.equal(formatReset("2026-09-02T02:10:00Z", now), "2h 10m");
  assert.equal(formatReset("2026-09-05T04:00:00Z", now), "3d 4h");
  assert.equal(formatReset("2026-09-02T00:45:30Z", now), "45m");
  assert.equal(formatReset("2026-09-02T00:00:10Z", now), "1m");
  assert.equal(formatReset("2026-09-01T23:00:00Z", now), "soon");
  assert.equal(formatReset(null, now), null);
  assert.equal(formatReset("garbage", now), null);
});

void test("statusCopy truth table: null for ok, one fixed line per other status", () => {
  const snapshot = (
    status: ClaudeUsageSnapshot["status"],
  ): ClaudeUsageSnapshot => ({
    status,
    windows: [],
    fetchedAt: null,
  });
  assert.equal(statusCopy(snapshot("ok")), null);
  assert.equal(
    statusCopy(snapshot("stale")),
    "Usage stale, refreshes on the next session",
  );
  assert.equal(
    statusCopy(snapshot("unavailable")),
    "Usage unavailable, sign in to see it",
  );
  assert.equal(
    statusCopy(snapshot("rate-limited")),
    "Usage rate limited, try again later",
  );
  assert.equal(statusCopy(snapshot("error")), "Usage could not be fetched");
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-09-01T00:00:00Z");

const win = (
  kind: string,
  percent: number,
  lengthMs: number,
  start: number = T0,
) => ({
  ...w(kind, percent),
  periodStart: new Date(start).toISOString(),
  periodEnd: new Date(start + lengthMs).toISOString(),
});

void test("pacingFor: badge thresholds at exactly 1.0 and 1.25, unrounded", () => {
  const at = (used: number) =>
    pacingFor(win("session", used, 5 * HOUR), T0 + HOUR)?.state;
  assert.equal(at(20), "on-track");
  assert.equal(at(25), "ahead");
  assert.equal(at(26), "will-run-out");
  assert.equal(at(19), "on-track");
  assert.equal(PACE_BADGE["on-track"].label, "On track");
  assert.equal(PACE_BADGE.ahead.label, "Ahead of budget");
  assert.equal(PACE_BADGE["will-run-out"].label, "Will run out");
  assert.equal(PACE_BADGE["on-track"].tone, "ok");
  assert.equal(PACE_BADGE.ahead.tone, "stale");
  assert.equal(PACE_BADGE["will-run-out"].tone, "down");
});

void test("pacedAtFor: the fetch instant for ok snapshots, null otherwise", () => {
  const snap = (
    status: ClaudeUsageSnapshot["status"],
    fetchedAt: string | null,
  ): ClaudeUsageSnapshot => ({ status, windows: [], fetchedAt });
  assert.equal(
    pacedAtFor(snap("ok", "2026-09-01T01:00:00Z")),
    Date.parse("2026-09-01T01:00:00Z"),
  );
  assert.equal(pacedAtFor(snap("ok", null)), null);
  assert.equal(pacedAtFor(snap("ok", "garbage")), null);
  assert.equal(pacedAtFor(snap("stale", "2026-09-01T01:00:00Z")), null);
  assert.equal(pacedAtFor(snap("error", "2026-09-01T01:00:00Z")), null);
  assert.equal(pacedAtFor(snap("rate-limited", "2026-09-01T01:00:00Z")), null);
  assert.equal(pacedAtFor(snap("unavailable", null)), null);
  assert.equal(pacingFor(win("session", 50, 5 * HOUR), Number.NaN), null);
});

void test("pacingFor: period start is On track with no projection and no throw", () => {
  const spend = win("spend", 26, 30 * DAY);
  const p = pacingFor(spend, T0);
  assert.deepEqual(p, {
    percentElapsed: 0,
    elapsedMs: 0,
    state: "on-track",
    exhaustsAt: null,
    capped: false,
  });
  assert.equal(pacingFor(spend, T0 - DAY)?.percentElapsed, 0);
  const fresh = pacingFor(win("session", 3, 5 * HOUR), T0 + 10_000)!;
  assert.equal(fresh.state, "on-track");
  assert.equal(fresh.exhaustsAt, null);
  assert.equal(
    pacingFor(win("session", 3, 5 * HOUR), T0 + 3 * 60_000)?.exhaustsAt !==
      null,
    true,
  );
});

void test("pacingFor: projection is linear from the period start and never past the end", () => {
  const session = win("session", 60, 5 * HOUR);
  const p = pacingFor(session, T0 + HOUR)!;
  assert.equal(p.state, "will-run-out");
  assert.equal(p.exhaustsAt, T0 + 100 * 60 * 1000);
  assert.equal(p.capped, false);
  const slow = pacingFor(win("session", 10, 5 * HOUR), T0 + HOUR)!;
  assert.equal(slow.exhaustsAt, T0 + 5 * HOUR);
  assert.equal(slow.capped, true);
  const idle = pacingFor(win("session", 0, 5 * HOUR), T0 + 2.5 * HOUR)!;
  assert.equal(idle.exhaustsAt, T0 + 5 * HOUR);
  assert.equal(idle.state, "on-track");
  assert.equal(idle.capped, true);
  const exact = pacingFor(win("session", 20, 5 * HOUR), T0 + HOUR)!;
  assert.equal(exact.capped, true);
  assert.equal(exact.exhaustsAt, T0 + 5 * HOUR);
  for (const used of [0, 1, 50, 99, 100]) {
    for (const t of [T0 + 1, T0 + HOUR, T0 + 4.99 * HOUR]) {
      const q = pacingFor(win("weekly_all", used, 7 * DAY), t)!;
      assert.ok(q.exhaustsAt === null || q.exhaustsAt <= T0 + 7 * DAY);
    }
  }
});

void test("pacingFor: a fully used window is Will run out", () => {
  const late = win("session", 100, 5 * HOUR);
  const p = pacingFor(late, T0 + 4.5 * HOUR)!;
  assert.equal(p.state, "will-run-out");
});

void test("pacingFor: the ticket's own figures read On track", () => {
  const monthStart = Date.parse("2026-09-01T00:00:00Z");
  const enterprise = win("spend", 26, 30 * DAY, monthStart);
  const e = pacingFor(enterprise, monthStart + 8 * DAY + 2 * HOUR)!;
  assert.equal(e.state, "on-track");
  assert.equal(Math.round(e.percentElapsed), 27);
  const teams = win("session", 6, 5 * HOUR);
  const t = pacingFor(teams, T0 + 5 * HOUR - (4 * HOUR + 12 * 60 * 1000))!;
  assert.equal(t.state, "on-track");
  assert.equal(Math.round(t.percentElapsed), 16);
});

void test("pacingFor: a period that is not a calendar month uses its own boundaries", () => {
  const start = Date.parse("2026-09-15T00:00:00Z");
  const w15 = win("spend", 50, 30 * DAY, start);
  const p = pacingFor(w15, start + 15 * DAY)!;
  assert.equal(p.percentElapsed, 50);
  assert.equal(p.state, "on-track");
  const fast = pacingFor(win("spend", 60, 30 * DAY, start), start + 10 * DAY)!;
  assert.equal(fast.exhaustsAt, start + (10 * DAY * 100) / 60);
});

void test("pacingFor: missing, unparseable, inverted or ended periods yield null", () => {
  assert.equal(pacingFor(w("session", 50), T0), null);
  assert.equal(
    pacingFor(
      {
        ...w("session", 50),
        periodStart: "garbage",
        periodEnd: "2026-09-01T05:00:00Z",
      },
      T0,
    ),
    null,
  );
  assert.equal(
    pacingFor(
      {
        ...w("session", 50),
        periodStart: "2026-09-01T05:00:00Z",
        periodEnd: "2026-09-01T00:00:00Z",
      },
      T0,
    ),
    null,
  );
  assert.equal(
    pacingFor(
      {
        ...w("session", 50),
        periodStart: "2026-09-01T00:00:00Z",
        periodEnd: "2026-09-01T00:00:00Z",
      },
      T0,
    ),
    null,
  );
  assert.equal(pacingFor(win("session", 95, 5 * HOUR), T0 + 5 * HOUR), null);
  assert.equal(pacingFor(win("session", 95, 5 * HOUR), T0 + 8 * HOUR), null);
});

void test("usageLine joins each window with its reset, or falls back to the status copy", () => {
  const now = Date.parse("2026-10-02T09:00:00Z");
  const usage: ClaudeUsageSnapshot = {
    status: "ok",
    windows: [
      {
        ...w("session", 45),
        label: "Session",
        resetsAt: "2026-10-02T11:10:00Z",
      },
      { ...w("weekly_all", 75), label: "Week" },
    ],
    fetchedAt: "2026-10-02T09:00:00Z",
  };
  assert.equal(usageLine(usage, now), "Session 45% (resets 2h 10m) · Week 75%");
  assert.equal(
    usageLine({ ...usage, windows: [] }, now),
    "Usage unavailable, sign in to see it",
  );
  assert.equal(
    usageLine({ ...usage, status: "stale" }, now),
    "Usage stale, refreshes on the next session",
  );
});

void test("chipState names the tightest window, its tone and reset, or the status copy", () => {
  const now = Date.parse("2026-10-02T09:00:00Z");
  const usage: ClaudeUsageSnapshot = {
    status: "ok",
    windows: [
      { ...w("session", 45), resetsAt: "2026-10-02T09:45:00Z" },
      { ...w("weekly_all", 95), resetsAt: "2026-10-03T10:00:00Z" },
      w("weekly_scoped", 75),
    ],
    fetchedAt: "2026-10-02T09:00:00Z",
  };
  assert.deepEqual(chipState(usage, now), {
    tone: "down",
    summary: "95% used, resets 1d 1h",
    label: "95%",
  });
  assert.deepEqual(chipState({ ...usage, windows: [w("session", 70)] }, now), {
    tone: "stale",
    summary: "70% used",
    label: "70%",
  });
  assert.deepEqual(chipState({ ...usage, status: "unavailable" }, now), {
    tone: "muted",
    summary: "Usage unavailable, sign in to see it",
    label: "Usage unavailable, sign in to see it",
  });
  assert.deepEqual(chipState({ ...usage, windows: [] }, now), {
    tone: "stale",
    summary: "usage stale",
    label: "usage stale",
  });
});

void test("loginExpiryView warns within 3 days or past, stays neutral later, null when absent", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(now + ms).toISOString();
  const soon = loginExpiryView(at(2 * day), now);
  assert.equal(soon?.tone, "warning");
  assert.ok(soon?.text.startsWith("Login expires"));
  assert.equal(loginExpiryView(at(30 * day), now)?.tone, "neutral");
  assert.equal(loginExpiryView(at(3 * day), now)?.tone, "warning");
  const past = loginExpiryView(at(-day), now);
  assert.equal(past?.tone, "warning");
  assert.ok(past?.text.startsWith("Login expired"));
  assert.equal(loginExpiryView(undefined, now), null);
  assert.equal(loginExpiryView("not-a-date", now), null);
});

void test("findWindow returns the first window of a kind, null when absent", () => {
  const usage: ClaudeUsageSnapshot = {
    status: "ok",
    windows: [w("weekly_all", 40), w("session", 55), w("session", 80)],
    fetchedAt: null,
  };
  assert.equal(findWindow(usage, "session")?.percent, 55);
  assert.equal(findWindow(usage, "weekly_all")?.percent, 40);
  assert.equal(findWindow(usage, "weekly_scoped"), null);
  assert.equal(findWindow({ ...usage, windows: [] }, "session"), null);
});

void test("popoverWindows returns session then weekly_all, only those present", () => {
  const snap = (...windows: ReturnType<typeof w>[]): ClaudeUsageSnapshot => ({
    status: "ok",
    windows,
    fetchedAt: null,
  });
  assert.deepEqual(
    popoverWindows(
      snap(w("weekly_all", 40), w("weekly_scoped", 12), w("session", 55)),
    ).map((x) => x.kind),
    ["session", "weekly_all"],
  );
  assert.deepEqual(
    popoverWindows(snap(w("weekly_scoped", 12), w("session", 55))).map(
      (x) => x.kind,
    ),
    ["session"],
  );
  assert.deepEqual(
    popoverWindows(snap(w("weekly_all", 40))).map((x) => x.kind),
    ["weekly_all"],
  );
  assert.deepEqual(popoverWindows(snap(w("weekly_scoped", 12))), []);
  assert.deepEqual(popoverWindows(snap()), []);
});

const account = (
  overrides: Partial<ClaudeAccountSummary> = {},
  usage: Partial<ClaudeUsageSnapshot> = {},
): ClaudeAccountSummary => ({
  id: "a1",
  email: "a@example.com",
  orgName: "Org",
  subscriptionType: "max",
  isDefault: true,
  usage: { status: "ok", windows: [], fetchedAt: null, ...usage },
  position: 0,
  state: "available",
  buckets: [],
  limitedUntil: null,
  inUse: true,
  ...overrides,
});

void test("accountStateLine: login expired by state or by a past loginExpiresAt, and it wins over limited", () => {
  const now = T0 + HOUR;
  const expired = { text: "Login expired, sign in again", tone: "down" };
  assert.deepEqual(
    accountStateLine(account({ state: "login-expired" }), now),
    expired,
  );
  assert.deepEqual(
    accountStateLine(
      account(
        { state: "available" },
        { loginExpiresAt: "2026-08-31T00:00:00Z" },
      ),
      now,
    ),
    expired,
  );
  assert.deepEqual(
    accountStateLine(
      account(
        { state: "limited", limitedUntil: "2026-09-01T10:30:00Z" },
        {
          loginExpiresAt: "2026-08-31T00:00:00Z",
        },
      ),
      now,
    ),
    expired,
  );
  assert.equal(
    accountStateLine(
      account({}, { loginExpiresAt: "2026-09-30T00:00:00Z" }),
      now,
    ),
    null,
  );
});

void test("accountStateLine: needs login reads as a login line, like login expired", () => {
  assert.deepEqual(
    accountStateLine(account({ state: "needs-login" }), T0 + HOUR),
    { text: "Login expired, sign in again", tone: "down" },
  );
});

void test("accountStateLine: limited names the reset time, or just Limited without one", () => {
  const now = T0 + HOUR;
  const soon = accountStateLine(
    account({ state: "limited", limitedUntil: "2026-09-01T10:30:00Z" }),
    now,
  )!;
  assert.ok(soon.text.startsWith("Limited until "));
  assert.equal(soon.tone, "down");
  const later = accountStateLine(
    account({ state: "limited", limitedUntil: "2026-09-03T10:30:00Z" }),
    now,
  )!;
  assert.ok(later.text.startsWith("Limited until "));
  assert.notEqual(later.text, soon.text);
  assert.deepEqual(
    accountStateLine(account({ state: "limited", limitedUntil: null }), now),
    { text: "Limited", tone: "down" },
  );
  assert.deepEqual(
    accountStateLine(
      account({ state: "limited", limitedUntil: "2026-09-01T00:30:00Z" }),
      now,
    ),
    { text: "Limited", tone: "down" },
  );
  assert.deepEqual(
    accountStateLine(
      account({ state: "limited", limitedUntil: new Date(now).toISOString() }),
      now,
    ),
    { text: "Limited", tone: "down" },
  );
  const localNoon = new Date(2026, 8, 1, 10, 0).getTime();
  const at = (offsetMs: number) =>
    accountStateLine(
      account({
        state: "limited",
        limitedUntil: new Date(localNoon + offsetMs).toISOString(),
      }),
      localNoon,
    )!.text;
  assert.notEqual(at(2 * HOUR), at(26 * HOUR));
  assert.ok(at(26 * HOUR).length > at(2 * HOUR).length);
  assert.deepEqual(
    accountStateLine(
      account({ state: "limited", limitedUntil: "garbage" }),
      now,
    ),
    { text: "Limited", tone: "down" },
  );
});

void test("accountStateLine: each non-ok status gives its copy, muted for unavailable and stale otherwise", () => {
  const now = T0 + HOUR;
  const line = (status: ClaudeUsageSnapshot["status"]) =>
    accountStateLine(account({}, { status }), now);
  assert.deepEqual(line("stale"), {
    text: "Usage stale, refreshes on the next session",
    tone: "stale",
  });
  assert.deepEqual(line("unavailable"), {
    text: "Usage unavailable, sign in to see it",
    tone: "muted",
  });
  assert.deepEqual(line("rate-limited"), {
    text: "Usage rate limited, try again later",
    tone: "stale",
  });
  assert.deepEqual(line("error"), {
    text: "Usage could not be fetched",
    tone: "stale",
  });
});

void test("accountStateLine: ok status reports the worst pace of session and weekly", () => {
  const now = T0 + HOUR;
  const fetchedAt = new Date(T0 + HOUR).toISOString();
  const line = (session: number, weekly: number) =>
    accountStateLine(
      account(
        {},
        {
          fetchedAt,
          windows: [
            win("session", session, 5 * HOUR),
            win("weekly_all", weekly, 7 * DAY, T0 - DAY),
          ],
        },
      ),
      now,
    );
  assert.deepEqual(line(60, 5), { text: "Will run out", tone: "down" });
  assert.deepEqual(line(10, 5), { text: "On track", tone: "ok" });
  assert.deepEqual(line(24, 5), { text: "Ahead of budget", tone: "stale" });
  assert.deepEqual(line(10, 60), { text: "Will run out", tone: "down" });
});

void test("accountStateLine: ok without period data falls back to Checked, then to null", () => {
  const now = T0 + HOUR;
  const checked = accountStateLine(
    account(
      {},
      { fetchedAt: "2026-09-01T01:00:00Z", windows: [w("session", 50)] },
    ),
    now,
  )!;
  assert.ok(checked.text.startsWith("Checked "));
  assert.equal(checked.tone, "muted");
  assert.equal(accountStateLine(account(), now), null);
  assert.equal(
    accountStateLine(account({}, { fetchedAt: "garbage" }), now),
    null,
  );
});
