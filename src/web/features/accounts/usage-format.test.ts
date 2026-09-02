import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeUsageSnapshot } from "../../../shared/types.js";
import {
  emailLocalPart,
  formatReset,
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
