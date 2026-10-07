import test from "node:test";
import assert from "node:assert/strict";
import type {
  ClaudeUsageSnapshot,
  ClaudeUsageStatus,
  ClaudeUsageWindow,
} from "../../../shared/types.js";
import { selectAccount } from "./account-selection.js";
import {
  deriveAccountState,
  isStaleSurface,
  parseSurfaceResetAt,
} from "./account-state.js";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const SESSION_RESET = "2026-10-06T14:00:00.000Z";
const WEEKLY_RESET = "2026-10-09T08:00:00.000Z";
const PLUS_FIVE_HOURS = new Date(NOW.getTime() + 5 * HOUR).toISOString();

/** A usage window of `kind` at `percent`. */
function win(
  kind: string,
  percent: number,
  resetsAt: string | null,
): ClaudeUsageWindow {
  return {
    kind,
    label: kind,
    percent,
    resetsAt,
    isActive: false,
    periodStart: null,
    periodEnd: null,
  };
}

/** A usage snapshot with `windows`, read at `NOW` unless the status says no read happened. */
function usage(
  windows: ClaudeUsageWindow[],
  status: ClaudeUsageStatus = "ok",
): ClaudeUsageSnapshot {
  return {
    status,
    windows,
    fetchedAt: status === "unavailable" ? null : NOW.toISOString(),
  };
}

void test("each bucket band around the default threshold of 100", () => {
  const cases: [number, string][] = [
    [0, "available"],
    [79, "available"],
    [80, "near-limit"],
    [99, "near-limit"],
    [100, "limited"],
    [130, "limited"],
  ];
  for (const [percent, state] of cases) {
    const derived = deriveAccountState(
      usage([
        win("session", percent, SESSION_RESET),
        win("weekly_all", 10, WEEKLY_RESET),
      ]),
      {},
      100,
      NOW,
    );
    assert.equal(derived.state, state, `${percent}%`);
    assert.equal(
      derived.limitedUntil,
      state === "limited" ? SESSION_RESET : null,
      `${percent}%`,
    );
  }
});

void test("each bucket band around a lower threshold of 90", () => {
  const cases: [number, string][] = [
    [79, "available"],
    [85, "near-limit"],
    [89, "near-limit"],
    [90, "limited"],
    [95, "limited"],
  ];
  for (const [percent, state] of cases) {
    const derived = deriveAccountState(
      usage([win("weekly_all", percent, WEEKLY_RESET)]),
      {},
      90,
      NOW,
    );
    assert.equal(derived.state, state, `${percent}%`);
  }
});

void test("a threshold below 80 has no near-limit band", () => {
  const at = (percent: number) =>
    deriveAccountState(
      usage([win("session", percent, SESSION_RESET)]),
      {},
      60,
      NOW,
    ).state;
  assert.equal(at(59), "available");
  assert.equal(at(60), "limited");
});

void test("the 7 day limit holds the account until the 7 day reset", () => {
  const derived = deriveAccountState(
    usage([
      win("session", 100, SESSION_RESET),
      win("weekly_all", 100, WEEKLY_RESET),
    ]),
    {},
    100,
    NOW,
  );
  assert.deepEqual(derived, { state: "limited", limitedUntil: WEEKLY_RESET });
  const weeklyOnly = deriveAccountState(
    usage([
      win("session", 5, SESSION_RESET),
      win("weekly_all", 100, WEEKLY_RESET),
    ]),
    { limit: { resetAt: "2026-10-06T13:00:00.000Z" } },
    100,
    NOW,
  );
  assert.deepEqual(weeklyOnly, {
    state: "limited",
    limitedUntil: WEEKLY_RESET,
  });
});

void test("a 7 day limited account stays out of the selection until the 7 day reset", () => {
  const limited = deriveAccountState(
    usage([
      win("session", 100, SESSION_RESET),
      win("weekly_all", 100, WEEKLY_RESET),
    ]),
    {},
    100,
    NOW,
  );
  const chain = [
    { id: "first", ...limited },
    { id: "second", state: "limited" as const, limitedUntil: SESSION_RESET },
  ];
  const afterSessionReset = new Date(Date.parse(SESSION_RESET) + HOUR);
  assert.deepEqual(selectAccount(chain, afterSessionReset), {
    exhausted: true,
    earliestReset: SESSION_RESET,
  });
  const reread = deriveAccountState(
    usage([win("session", 0, null), win("weekly_all", 0, null)]),
    {},
    100,
    new Date(WEEKLY_RESET),
  );
  assert.deepEqual(
    selectAccount([{ id: "first", ...reread }], new Date(WEEKLY_RESET)),
    { exhausted: false, id: "first" },
  );
});

void test("a full bucket with no reset falls back to the surface time, then the 5 hour reset, then 5 hours", () => {
  const surface = "2026-10-06T13:40:00.000Z";
  const full = win("weekly_all", 100, null);
  assert.equal(
    deriveAccountState(
      usage([full, win("session", 40, SESSION_RESET)]),
      { limit: { resetAt: surface } },
      100,
      NOW,
    ).limitedUntil,
    surface,
  );
  assert.equal(
    deriveAccountState(
      usage([full, win("session", 40, SESSION_RESET)]),
      {},
      100,
      NOW,
    ).limitedUntil,
    SESSION_RESET,
  );
  assert.equal(
    deriveAccountState(usage([full, win("session", 40, null)]), {}, 100, NOW)
      .limitedUntil,
    PLUS_FIVE_HOURS,
  );
});

void test("a limit signal limits the account under the threshold and uses the same fallbacks", () => {
  const surface = "2026-10-06T13:40:00.000Z";
  const below = [win("session", 30, SESSION_RESET)];
  assert.deepEqual(
    deriveAccountState(usage(below), { limit: { resetAt: surface } }, 100, NOW),
    { state: "limited", limitedUntil: surface },
  );
  assert.deepEqual(
    deriveAccountState(usage(below), { limit: { resetAt: null } }, 100, NOW),
    { state: "limited", limitedUntil: SESSION_RESET },
  );
  assert.deepEqual(
    deriveAccountState(
      usage([], "unavailable"),
      { limit: { resetAt: null } },
      100,
      NOW,
    ),
    { state: "limited", limitedUntil: PLUS_FIVE_HOURS },
  );
});

void test("the latest reset of several full buckets wins", () => {
  const later = "2026-10-07T00:00:00.000Z";
  assert.equal(
    deriveAccountState(
      usage([
        win("session", 100, later),
        win("weekly_scoped", 100, SESSION_RESET),
      ]),
      {},
      100,
      NOW,
    ).limitedUntil,
    later,
  );
});

void test("a 401 or 403 with a logged out folder is login-expired", () => {
  const stale = usage([win("session", 10, SESSION_RESET)], "stale");
  assert.deepEqual(deriveAccountState(stale, { loggedIn: false }, 100, NOW), {
    state: "login-expired",
    limitedUntil: null,
  });
  assert.deepEqual(
    deriveAccountState(
      stale,
      { loggedIn: false, limit: { resetAt: null } },
      100,
      NOW,
    ),
    { state: "login-expired", limitedUntil: null },
  );
  assert.equal(
    deriveAccountState(usage([], "unavailable"), { loggedIn: false }, 100, NOW)
      .state,
    "login-expired",
  );
});

void test("a stale read with a logged in folder is unknown, whatever its old windows", () => {
  const stale = usage([win("session", 100, SESSION_RESET)], "stale");
  for (const loggedIn of [true, null, undefined]) {
    assert.deepEqual(
      deriveAccountState(stale, { loggedIn }, 100, NOW),
      { state: "unknown", limitedUntil: null },
      String(loggedIn),
    );
  }
});

void test("no usable read yet is unknown", () => {
  assert.deepEqual(deriveAccountState(usage([], "unavailable"), {}, 100, NOW), {
    state: "unknown",
    limitedUntil: null,
  });
  assert.equal(deriveAccountState(usage([]), {}, 100, NOW).state, "unknown");
  assert.equal(
    deriveAccountState(
      { status: "error", windows: [], fetchedAt: null, error: "unreachable" },
      { loggedIn: true },
      100,
      NOW,
    ).state,
    "unknown",
  );
});

void test("a 429 or network error keeps the state of the last good read", () => {
  for (const status of ["rate-limited", "error"] as const) {
    assert.equal(
      deriveAccountState(
        usage([win("session", 85, SESSION_RESET)], status),
        {},
        100,
        NOW,
      ).state,
      "near-limit",
    );
  }
});

void test("the surface time parses as the next local clock time", () => {
  const local = (h: number, m: number, dayOffset = 0) =>
    new Date(2026, 9, 6 + dayOffset, h, m).toISOString();
  const morning = new Date(2026, 9, 6, 9, 0);
  const pane = (when: string) =>
    `Usage limit reached · continuing automatically ${when} · esc to cancel`;
  assert.equal(parseSurfaceResetAt(pane("at 10:40am"), morning), local(10, 40));
  assert.equal(parseSurfaceResetAt(pane("at 3pm"), morning), local(15, 0));
  assert.equal(parseSurfaceResetAt(pane("at 12:15pm"), morning), local(12, 15));
  assert.equal(parseSurfaceResetAt(pane("at 12am"), morning), local(0, 0, 1));
  assert.equal(
    parseSurfaceResetAt(pane("at 8:30AM"), morning),
    local(8, 30, 1),
  );
  assert.equal(parseSurfaceResetAt(pane("at 9am"), morning), local(9, 0, 1));
  assert.equal(
    parseSurfaceResetAt(
      "❯ 2. Wait here, then continue automatically at 11:05pm",
      morning,
    ),
    local(23, 5),
  );
  assert.equal(
    parseSurfaceResetAt(
      `${pane("at 10:00am")}\n${pane("at 10:40am")}`,
      morning,
    ),
    local(10, 40),
  );
  assert.equal(parseSurfaceResetAt(pane("shortly"), morning), null);
  assert.equal(parseSurfaceResetAt(pane("at 13:00pm"), morning), null);
  assert.equal(parseSurfaceResetAt("no limit here", morning), null);
});

void test("a surface past its reset is stale only after a newer read below the threshold", () => {
  const local = (h: number, m: number) => new Date(2026, 9, 6, h, m);
  const now = local(9, 30);
  const pane = (when: string) =>
    `Usage limit reached · continuing automatically at ${when} · esc to cancel`;
  const read = (
    percent: number,
    at: Date,
    status: ClaudeUsageStatus = "ok",
  ) => ({
    status,
    windows: [win("session", percent, null)],
    fetchedAt: at.toISOString(),
  });
  const after = read(5, local(9, 10));
  assert.equal(isStaleSurface(pane("9am"), after, 100, now), true);
  assert.equal(
    isStaleSurface(pane("9am"), read(5, local(8, 50)), 100, now),
    false,
  );
  assert.equal(
    isStaleSurface(pane("9am"), read(100, local(9, 10)), 100, now),
    false,
  );
  assert.equal(
    isStaleSurface(pane("9am"), read(5, local(9, 10), "stale"), 100, now),
    false,
  );
  assert.equal(isStaleSurface(pane("10:40am"), after, 100, now), false);
  assert.equal(isStaleSurface(pane("3am"), after, 100, now), false);
  assert.equal(isStaleSurface("no limit here", after, 100, now), false);
});
