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
  expireLimit,
  chainStateOf,
  isShadowOfHome,
  isStaleSurface,
  NEEDS_LOGIN_READS,
  nextRejectedReads,
  parseSurfaceResetAt,
  showsNewPeriod,
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

void test("a full bucket whose reset passed is not full", () => {
  const passed = "2026-10-06T11:00:00.000Z";
  const derive = (windows: ClaudeUsageWindow[]) =>
    deriveAccountState(usage(windows), {}, 100, NOW);
  assert.deepEqual(derive([win("weekly_all", 100, passed)]), {
    state: "near-limit",
    limitedUntil: null,
  });
  assert.deepEqual(derive([win("weekly_all", 100, NOW.toISOString())]), {
    state: "near-limit",
    limitedUntil: null,
  });
  assert.equal(
    derive([win("weekly_all", 40, WEEKLY_RESET), win("session", 100, passed)])
      .state,
    "near-limit",
  );
  assert.deepEqual(
    derive([
      win("weekly_all", 100, passed),
      win("session", 100, SESSION_RESET),
    ]),
    { state: "limited", limitedUntil: SESSION_RESET },
  );
  assert.equal(derive([win("weekly_all", 100, null)]).state, "limited");
});

void test("expireLimit turns a passed limit into unknown and leaves every other state alone", () => {
  const future = "2026-10-06T12:00:00.001Z";
  const cases: [
    Parameters<typeof expireLimit>[0],
    ReturnType<typeof expireLimit>,
  ][] = [
    [
      { state: "limited", limitedUntil: future },
      { state: "limited", limitedUntil: future },
    ],
    [
      { state: "limited", limitedUntil: NOW.toISOString() },
      { state: "unknown", limitedUntil: null },
    ],
    [
      { state: "limited", limitedUntil: "2026-10-06T11:00:00.000Z" },
      { state: "unknown", limitedUntil: null },
    ],
    [
      { state: "limited", limitedUntil: null },
      { state: "limited", limitedUntil: null },
    ],
    [
      { state: "available", limitedUntil: null },
      { state: "available", limitedUntil: null },
    ],
    [
      { state: "near-limit", limitedUntil: null },
      { state: "near-limit", limitedUntil: null },
    ],
    [
      { state: "login-expired", limitedUntil: null },
      { state: "login-expired", limitedUntil: null },
    ],
    [
      { state: "unknown", limitedUntil: null },
      { state: "unknown", limitedUntil: null },
    ],
  ];
  for (const [entry, expected] of cases) {
    assert.deepEqual(expireLimit(entry, NOW), expected, JSON.stringify(entry));
  }
});

void test("expireLimit returns the entry it was given when nothing expired", () => {
  const entry = { state: "available" as const, limitedUntil: null };
  assert.equal(expireLimit(entry, NOW), entry);
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

const PRIOR_FETCHED = "2026-10-06T10:00:00.000Z";
const PRIOR_LIMITED_UNTIL = "2026-10-08T07:00:00.000Z";
const PRIOR = { fetchedAt: PRIOR_FETCHED, limitedUntil: PRIOR_LIMITED_UNTIL };

/** A weekly window at `percent` that started at `periodStart`. */
function weekly(
  percent: number,
  resetsAt: string | null,
  periodStart: string | null,
): ClaudeUsageWindow {
  return { ...win("weekly_all", percent, resetsAt), periodStart };
}

void test("showsNewPeriod is true when a period started after the stored read", () => {
  const snapshot = usage([
    weekly(1, PRIOR_LIMITED_UNTIL, "2026-10-06T11:00:00.000Z"),
  ]);
  assert.equal(showsNewPeriod(snapshot, PRIOR, 100), true);
});

void test("showsNewPeriod is true when no reset equals limitedUntil any more", () => {
  const snapshot = usage([weekly(1, "2026-10-13T07:00:00.000Z", null)]);
  assert.equal(showsNewPeriod(snapshot, PRIOR, 100), true);
});

void test("showsNewPeriod is false when a reset still equals limitedUntil and no period started", () => {
  const snapshot = usage([
    weekly(1, PRIOR_LIMITED_UNTIL, "2026-10-01T07:00:00.000Z"),
  ]);
  assert.equal(showsNewPeriod(snapshot, PRIOR, 100), false);
});

void test("showsNewPeriod compares reset times by value, not by string", () => {
  const snapshot = usage([weekly(1, "2026-10-08T07:00:00Z", null)]);
  assert.equal(showsNewPeriod(snapshot, PRIOR, 100), false);
});

void test("showsNewPeriod is false when one window is at the threshold", () => {
  const snapshot = usage([
    weekly(1, "2026-10-13T07:00:00.000Z", null),
    win("session", 100, "2026-10-06T15:00:00.000Z"),
  ]);
  assert.equal(showsNewPeriod(snapshot, PRIOR, 100), false);
});

void test("showsNewPeriod is false for a stale snapshot", () => {
  const snapshot = usage(
    [weekly(1, "2026-10-13T07:00:00.000Z", null)],
    "stale",
  );
  assert.equal(showsNewPeriod(snapshot, PRIOR, 100), false);
});

void test("showsNewPeriod is false with no windows or no fetchedAt", () => {
  assert.equal(showsNewPeriod(usage([]), PRIOR, 100), false);
  const noFetch = usage([weekly(1, "2026-10-13T07:00:00.000Z", null)]);
  assert.equal(
    showsNewPeriod({ ...noFetch, fetchedAt: null }, PRIOR, 100),
    false,
  );
});

void test("showsNewPeriod is false when fetchedAt is not newer than the stored one", () => {
  const snapshot = {
    ...usage([weekly(1, "2026-10-13T07:00:00.000Z", null)]),
    fetchedAt: PRIOR_FETCHED,
  };
  assert.equal(showsNewPeriod(snapshot, PRIOR, 100), false);
});

void test("showsNewPeriod without a stored fetchedAt relies on the reset alone", () => {
  const unknownPrior = { limitedUntil: PRIOR_LIMITED_UNTIL };
  const same = usage([
    weekly(1, PRIOR_LIMITED_UNTIL, "2026-10-06T11:00:00.000Z"),
  ]);
  const moved = usage([weekly(1, "2026-10-13T07:00:00.000Z", null)]);
  assert.equal(showsNewPeriod(same, unknownPrior, 100), false);
  assert.equal(showsNewPeriod(moved, unknownPrior, 100), true);
  assert.equal(
    showsNewPeriod(moved, { ...unknownPrior, fetchedAt: null }, 100),
    true,
  );
});

void test("nextRejectedReads counts consecutive token-rejected reads and needs two of them", () => {
  const rejected: ClaudeUsageSnapshot = {
    ...usage([], "stale"),
    error: "token-rejected",
  };
  const first = nextRejectedReads(undefined, rejected);
  assert.equal(first, 1);
  assert.equal(nextRejectedReads(first, rejected), 2);
  assert.equal(NEEDS_LOGIN_READS, 2);
});

void test("nextRejectedReads keeps the count on a 429, an error or an unavailable read, and an ok read or an expired access token resets it", () => {
  for (const status of ["rate-limited", "error", "unavailable"] as const) {
    const snapshot: ClaudeUsageSnapshot = {
      ...usage([], status),
      error: status,
    };
    assert.equal(nextRejectedReads(1, snapshot), 1, status);
    assert.equal(nextRejectedReads(undefined, snapshot), 0, status);
  }
  assert.equal(nextRejectedReads(1, usage([])), 0);
  assert.equal(
    nextRejectedReads(1, { ...usage([], "stale"), error: "token-expired" }),
    0,
  );
  assert.equal(nextRejectedReads(5, usage([win("session", 10, null)])), 0);
});

void test("isShadowOfHome needs an equal email and equal non-empty organisation ids", () => {
  const home = { email: "a@example.com", orgId: "org" };
  assert.equal(
    isShadowOfHome({ email: "a@example.com", orgId: "org" }, home),
    true,
  );
  assert.equal(
    isShadowOfHome({ email: "a@example.com", orgId: "" }, home),
    false,
  );
  assert.equal(
    isShadowOfHome(
      { email: "a@example.com", orgId: "org" },
      { email: "a@example.com", orgId: "" },
    ),
    false,
  );
  assert.equal(
    isShadowOfHome(
      { email: "a@example.com", orgId: "" },
      { email: "a@example.com", orgId: "" },
    ),
    false,
  );
  assert.equal(
    isShadowOfHome({ email: "a@example.com", orgId: "other" }, home),
    false,
  );
  assert.equal(
    isShadowOfHome({ email: "b@example.com", orgId: "org" }, home),
    false,
  );
  assert.equal(
    isShadowOfHome({ email: "a@example.com", orgId: "org" }, undefined),
    false,
  );
  assert.equal(
    isShadowOfHome({ email: "", orgId: "org" }, { email: "", orgId: "org" }),
    false,
  );
});

void test("chainStateOf picks shadowed, then needs-login, then the hold, then the derived state", () => {
  const derived = { state: "available", limitedUntil: null } as const;
  const base = {
    shadowed: false,
    needsLogin: false,
    held: false,
    heldUntil: null,
    derived,
  };
  const until = "2026-10-20T14:00:00.000Z";
  const all = { ...base, shadowed: true, needsLogin: true, held: true };
  assert.deepEqual(chainStateOf({ ...all, heldUntil: until }), {
    state: "shadowed-by-home",
    limitedUntil: null,
  });
  assert.deepEqual(chainStateOf({ ...all, shadowed: false }), {
    state: "needs-login",
    limitedUntil: null,
  });
  assert.deepEqual(chainStateOf({ ...base, held: true, heldUntil: until }), {
    state: "limited",
    limitedUntil: until,
  });
  assert.deepEqual(chainStateOf(base), derived);
});
