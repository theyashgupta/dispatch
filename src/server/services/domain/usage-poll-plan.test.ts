import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_POLL_STATE,
  bindingPercent,
  planNextPoll,
  type PollInput,
  type PollPlan,
  type PollResult,
  type PollState,
} from "./usage-poll-plan.js";

const NOW = 1_000_000_000_000;
const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const MID = () => 0.5;

/** A poll state with `intervalS` seconds as the last base interval. */
function state(
  intervalS: number | null,
  lastPercent: number | null = null,
  last429At: number | null = null,
): PollState {
  return {
    intervalMs: intervalS === null ? null : intervalS * S,
    lastPercent,
    last429At,
  };
}

function ok(
  percent: number | null,
  nextResetAt: number | null = null,
): PollResult {
  return { kind: "ok", bindingPercent: percent, nextResetAt };
}

/** Plan the next poll with no jitter, a threshold of 100 and an idle account unless `extra` says otherwise. */
function plan(
  prev: PollState,
  result: PollResult,
  extra: Partial<PollInput> = {},
): PollPlan {
  return planNextPoll(prev, {
    now: NOW,
    inUse: false,
    thresholdPercent: 100,
    result,
    random: MID,
    ...extra,
  });
}

function delayOf(p: PollPlan): number {
  return p.nextDueAt - NOW;
}

/** A deterministic pseudo random generator returning values in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

void test("the first ok read plans 300 seconds", () => {
  const p = plan(INITIAL_POLL_STATE, ok(10));
  assert.equal(delayOf(p), 300_000);
  assert.deepEqual(p.state, {
    intervalMs: 300_000,
    lastPercent: 10,
    last429At: null,
  });
  assert.equal(p.holdUntil, null);
});

void test("an idle account with no movement grows 300, 450, 600, 600", () => {
  let s: PollState = INITIAL_POLL_STATE;
  const delays: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = plan(s, ok(10));
    delays.push(delayOf(p));
    s = p.state;
  }
  assert.deepEqual(delays, [300_000, 450_000, 600_000, 600_000]);
});

void test("an in-use account with no movement caps at 300 seconds", () => {
  let s: PollState = INITIAL_POLL_STATE;
  const delays: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = plan(s, ok(10), { inUse: true });
    delays.push(delayOf(p));
    s = p.state;
  }
  assert.deepEqual(delays, [300_000, 300_000, 300_000, 300_000]);
  assert.equal(delayOf(plan(state(180, 10), ok(10), { inUse: true })), 270_000);
});

void test("a move of 2 points halves the interval down to the 180 second floor", () => {
  assert.equal(delayOf(plan(state(600, 10), ok(12))), 300_000);
  assert.equal(delayOf(plan(state(300, 10), ok(12))), 180_000);
  assert.equal(delayOf(plan(state(180, 10), ok(12))), 180_000);
  assert.equal(delayOf(plan(state(600, 50), ok(52), { inUse: true })), 300_000);
});

void test("an urgent read plans 60 seconds only below the threshold and when all four conditions hold", () => {
  const prev = state(300, 85);
  assert.equal(delayOf(plan(prev, ok(87), { inUse: true })), 60_000);
  assert.equal(delayOf(plan(prev, ok(87), { inUse: false })), 180_000);
  assert.equal(delayOf(plan(state(300, 87), ok(87), { inUse: true })), 300_000);
  assert.equal(
    delayOf(plan(state(300, 85, NOW - 30 * MIN), ok(87), { inUse: true })),
    450_000,
  );
  assert.equal(delayOf(plan(state(300, 70), ok(72), { inUse: true })), 180_000);
  assert.equal(
    delayOf(plan(state(300, 98), ok(100), { inUse: true })),
    600_000,
  );
});

void test("a limited account waits at least 600 seconds", () => {
  assert.equal(delayOf(plan(INITIAL_POLL_STATE, ok(100))), 600_000);
  assert.equal(
    delayOf(plan(state(1800, 92), ok(92), { thresholdPercent: 90 })),
    600_000,
  );
});

void test("a limited account plans a 600 second interval, never the grown base", () => {
  const p = plan(state(1800, 92), ok(92), { thresholdPercent: 90 });
  assert.equal(p.state.intervalMs, 600_000);
  assert.equal(delayOf(p), 600_000);
});

void test("the limited minimum beats jitter but not the reset clamp", () => {
  const prev = state(600, 92);
  const limited = { thresholdPercent: 90, random: () => 0 };
  assert.equal(delayOf(plan(prev, ok(92), limited)), 600_000);
  assert.equal(delayOf(plan(prev, ok(92, NOW + 120 * S), limited)), 180_000);
});

void test("a drop toward the threshold is not urgent", () => {
  const p = plan(state(300, 90), ok(88), { inUse: true });
  assert.notEqual(p.state.intervalMs, 60_000);
  assert.equal(delayOf(p), 180_000);
});

void test("a moved in-use read never plans past the 300 second ceiling", () => {
  const p = plan(state(1800, 40), ok(50), {
    inUse: true,
    random: () => 0.999999,
  });
  assert.ok(delayOf(p) <= 330_000, `got ${delayOf(p)}`);
});

void test("the first read after a 429 plans at least 360 seconds", () => {
  const prev = state(180, 10, NOW - 10 * MIN);
  assert.ok(delayOf(plan(prev, ok(10), { random: () => 0 })) >= 360_000);
  assert.ok(
    delayOf(plan(prev, ok(10, NOW + 130 * S), { random: () => 0 })) >= 360_000,
  );
});

void test("the slow hour starts when the hold ends", () => {
  const limited = plan(state(300, 10), {
    kind: "rate-limited",
    retryAfterMs: 7_200_000,
  });
  const holdEnd = NOW + 8_100_000;
  assert.equal(limited.holdUntil, holdEnd);
  assert.equal(limited.state.last429At, holdEnd);
  const after = (ms: number, prev: PollState): number =>
    planNextPoll(prev, {
      now: holdEnd + ms,
      inUse: false,
      thresholdPercent: 100,
      result: ok(12),
      random: () => 0,
    }).nextDueAt -
    (holdEnd + ms);
  const prev = state(180, 10, holdEnd);
  assert.ok(after(0, prev) >= 360_000);
  assert.ok(after(59 * MIN, prev) >= 360_000);
  assert.equal(after(61 * MIN, prev), 180_000);
});

void test("jitter spreads a 600 second interval between 540 and 600 seconds", () => {
  const prev = state(600, 10);
  assert.equal(delayOf(plan(prev, ok(10), { random: () => 0 })), 540_000);
  assert.equal(
    delayOf(plan(prev, ok(10), { random: () => 0.999999 })),
    600_000,
  );
});

void test("jitter spreads a 300 second interval up to 330 seconds", () => {
  const prev = state(300, 10);
  const high = delayOf(
    plan(prev, ok(10), { inUse: true, random: () => 0.999999 }),
  );
  assert.ok(high > 329_900 && high < 330_000, `got ${high}`);
});

void test("jitter never pushes a post-429 delay past 1800 seconds", () => {
  const prev = state(1800, 10, NOW - 10 * MIN);
  assert.equal(
    delayOf(plan(prev, ok(10), { random: () => 0.999999 })),
    1_800_000,
  );
});

void test("the reset clamp shortens the delay but the 180 second floor wins", () => {
  const prev = state(600, 10);
  assert.equal(delayOf(plan(prev, ok(10, NOW + 400 * S))), 460_000);
  assert.equal(delayOf(plan(prev, ok(10, NOW + 30 * S))), 180_000);
});

void test("a 429 holds for the Retry-After plus 900 seconds", () => {
  const p = plan(state(300, 40), {
    kind: "rate-limited",
    retryAfterMs: 600_000,
  });
  assert.equal(p.holdUntil, NOW + 1_500_000);
  assert.equal(p.nextDueAt, NOW + 1_500_000);
  assert.equal(p.state.last429At, NOW + 1_500_000);
  assert.equal(p.state.lastPercent, 40);
  assert.ok((p.state.intervalMs ?? 0) >= 360_000);
  const hold = (retryAfterMs: number | null): number | null =>
    plan(INITIAL_POLL_STATE, { kind: "rate-limited", retryAfterMs }).holdUntil;
  assert.equal(hold(null), NOW + 1_200_000);
  assert.equal(hold(0), NOW + 1_200_000);
  assert.equal(hold(2 * 86_400_000), NOW + 87_300_000);
});

void test("an ok read within an hour of a 429 backs off further", () => {
  const ago10 = NOW - 10 * MIN;
  assert.equal(delayOf(plan(state(360, 10, ago10), ok(10))), 540_000);
  assert.equal(delayOf(plan(state(1600, 10, ago10), ok(10))), 1_800_000);
  assert.equal(delayOf(plan(state(1600, 10, NOW - 61 * MIN), ok(10))), 600_000);
  assert.equal(delayOf(plan(state(180, 10, NOW - 61 * MIN), ok(10))), 270_000);
});

void test("a rejected read plans 600 seconds and a failed read grows the interval", () => {
  const rejected = plan(state(300, 40, NOW - 5 * MIN), { kind: "rejected" });
  assert.equal(delayOf(rejected), 600_000);
  assert.deepEqual(rejected.state, {
    intervalMs: 600_000,
    lastPercent: 40,
    last429At: NOW - 5 * MIN,
  });
  const failed = plan(state(300, 40), { kind: "failed" });
  assert.equal(delayOf(failed), 450_000);
  assert.equal(failed.state.lastPercent, 40);
  assert.equal(delayOf(plan(INITIAL_POLL_STATE, { kind: "failed" })), 300_000);
});

void test("a scale of 60 divides every duration", () => {
  assert.equal(delayOf(plan(INITIAL_POLL_STATE, ok(10), { scale: 60 })), 5_000);
  const p = plan(
    INITIAL_POLL_STATE,
    { kind: "rate-limited", retryAfterMs: 60_000 },
    { scale: 60 },
  );
  assert.equal(p.holdUntil, NOW + 16_000);
});

void test("bindingPercent returns the highest percent or null", () => {
  assert.equal(bindingPercent([]), null);
  assert.equal(
    bindingPercent([{ percent: 3 }, { percent: 86 }, { percent: 35 }]),
    86,
  );
});

void test("random cases never break the floor, the post-429 cap or the hold cap", () => {
  const rnd = mulberry32(107);
  const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)];
  for (let i = 0; i < 2000; i++) {
    const now = NOW + Math.floor(rnd() * 10 * HOUR);
    const prev: PollState = {
      intervalMs: rnd() < 0.2 ? null : Math.floor(rnd() * 2_500_000),
      lastPercent: rnd() < 0.2 ? null : Math.floor(rnd() * 120),
      last429At: rnd() < 0.4 ? null : now - Math.floor(rnd() * 2 * HOUR),
    };
    const result: PollResult = pick<PollResult>([
      {
        kind: "ok",
        bindingPercent: rnd() < 0.1 ? null : Math.floor(rnd() * 120),
        nextResetAt:
          rnd() < 0.5 ? null : now + Math.floor(rnd() * HOUR) - 60 * S,
      },
      {
        kind: "rate-limited",
        retryAfterMs: pick([null, 0, -5, Math.floor(rnd() * 2e9)]),
      },
      { kind: "rejected" },
      { kind: "failed" },
    ]);
    const p = planNextPoll(prev, {
      now,
      inUse: rnd() < 0.5,
      thresholdPercent: pick([50, 90, 100]),
      result,
      random: rnd,
    });
    if (result.kind === "rate-limited") {
      assert.ok(p.holdUntil !== null && p.holdUntil - now <= 87_300_000);
      continue;
    }
    const urgent = result.kind === "ok" && p.state.intervalMs === 60_000;
    if (!urgent) assert.ok(p.nextDueAt - now >= 180_000, `case ${i}`);
    const recent429 = prev.last429At !== null && now - prev.last429At < HOUR;
    if (recent429 && !urgent && result.kind !== "rejected") {
      assert.ok((p.state.intervalMs ?? 0) <= 1_800_000, `case ${i}`);
      assert.ok(p.nextDueAt - now >= 360_000, `case ${i}`);
    }
    if (recent429) assert.ok(p.nextDueAt - now <= 1_800_000, `case ${i}`);
  }
});

void test("a one-day simulation keeps each account at 20 reads per hour or fewer", () => {
  const rnd = mulberry32(2026);
  const percentAt = {
    a: (t: number) => Math.min(80, 40 + Math.floor(t / (20 * MIN))),
    b: () => 30,
  };
  for (const [name, inUse] of [
    ["a", true],
    ["b", false],
  ] as const) {
    let s: PollState = INITIAL_POLL_STATE;
    let t = 0;
    const perHour = new Array<number>(24).fill(0);
    while (t < 24 * HOUR) {
      perHour[Math.floor(t / HOUR)]++;
      const p = planNextPoll(s, {
        now: t,
        inUse,
        thresholdPercent: 100,
        result: ok(percentAt[name](t)),
        random: rnd,
      });
      s = p.state;
      t = p.nextDueAt;
    }
    for (let h = 1; h < 24; h++) {
      assert.ok(
        perHour[h] <= 20,
        `account ${name} hour ${h} had ${perHour[h]}`,
      );
    }
  }
});
