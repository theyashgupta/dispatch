import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeUsageSnapshot } from "../../../shared/types.js";
import {
  emailLocalPart,
  formatReset,
  PACE_BADGE,
  pacedAtFor,
  paceTitle,
  pacingFor,
  projectionCopy,
  statusCopy,
  tightestWindow,
  toneColor,
  toneFor,
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
  assert.equal(toneColor("down"), "var(--status-down)");
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

void test("emailLocalPart", () => {
  assert.equal(emailLocalPart("yash@example.com"), "yash");
  assert.equal(emailLocalPart("Not signed in"), "Not signed in");
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
  assert.equal(PACE_BADGE["will-run-out"].text, "var(--destructive-text)");
  assert.equal(PACE_BADGE["on-track"].text, "var(--status-ok)");
  assert.equal(PACE_BADGE.ahead.text, "var(--status-stale)");
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
  assert.equal(projectionCopy(spend, p, T0), null);
  assert.equal(paceTitle(spend, p), "Used 26% · Elapsed 0%");
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
  assert.equal(
    projectionCopy(session, p, T0 + HOUR),
    "At this rate, limit hits in 40m",
  );
  const slow = pacingFor(win("session", 10, 5 * HOUR), T0 + HOUR)!;
  assert.equal(slow.exhaustsAt, T0 + 5 * HOUR);
  assert.equal(slow.capped, true);
  assert.equal(
    projectionCopy(win("session", 10, 5 * HOUR), slow, T0 + HOUR),
    "At this rate, limit holds until reset",
  );
  const idle = pacingFor(win("session", 0, 5 * HOUR), T0 + 2.5 * HOUR)!;
  assert.equal(idle.exhaustsAt, T0 + 5 * HOUR);
  assert.equal(idle.state, "on-track");
  assert.equal(idle.capped, true);
  assert.equal(
    projectionCopy(win("session", 0, 5 * HOUR), idle, T0 + 2.5 * HOUR),
    "At this rate, limit holds until reset",
  );
  const exact = pacingFor(win("session", 20, 5 * HOUR), T0 + HOUR)!;
  assert.equal(exact.capped, true);
  assert.equal(exact.exhaustsAt, T0 + 5 * HOUR);
  assert.equal(
    projectionCopy(session, p, T0 + 2 * HOUR),
    "At this rate, limit hits soon",
  );
  for (const used of [0, 1, 50, 99, 100]) {
    for (const t of [T0 + 1, T0 + HOUR, T0 + 4.99 * HOUR]) {
      const q = pacingFor(win("weekly_all", used, 7 * DAY), t)!;
      assert.ok(q.exhaustsAt === null || q.exhaustsAt <= T0 + 7 * DAY);
    }
  }
});

void test("pacingFor: a fully used window is Will run out and reads as reached", () => {
  const late = win("session", 100, 5 * HOUR);
  const p = pacingFor(late, T0 + 4.5 * HOUR)!;
  assert.equal(p.state, "will-run-out");
  assert.equal(projectionCopy(late, p, T0 + 4.5 * HOUR), "Limit reached");
  const spend = win("spend", 100, 30 * DAY);
  assert.equal(
    projectionCopy(spend, pacingFor(spend, T0 + DAY)!, T0 + DAY),
    "Credit used up",
  );
});

void test("pacingFor: the ticket's own figures read On track", () => {
  const monthStart = Date.parse("2026-09-01T00:00:00Z");
  const enterprise = win("spend", 26, 30 * DAY, monthStart);
  const e = pacingFor(enterprise, monthStart + 8 * DAY + 2 * HOUR)!;
  assert.equal(e.state, "on-track");
  assert.equal(Math.round(e.percentElapsed), 27);
  assert.equal(
    projectionCopy(enterprise, e, monthStart + 8 * DAY),
    "At this rate, credit lasts the month",
  );
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
  assert.match(
    projectionCopy(win("spend", 60, 30 * DAY, start), fast, start + 10 * DAY)!,
    /^At this rate, credit runs out on /,
  );
  assert.equal(
    paceTitle(win("spend", 60, 30 * DAY, start), fast),
    "Used 60% · Elapsed 33% · 6.0%/day",
  );
  assert.equal(
    paceTitle(
      win("session", 60, 5 * HOUR),
      pacingFor(win("session", 60, 5 * HOUR), T0 + HOUR)!,
    ),
    "Used 60% · Elapsed 20% · 60.0%/hour",
  );
  assert.equal(
    paceTitle(
      win("weekly_all", 7, 7 * DAY),
      pacingFor(win("weekly_all", 7, 7 * DAY), T0 + DAY)!,
    ),
    "Used 7% · Elapsed 14% · 7.0%/day",
  );
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
