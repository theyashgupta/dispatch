import test from "node:test";
import assert from "node:assert/strict";
import type { ChainAccountState } from "../../../shared/types.js";
import {
  type ChainCandidate,
  filterByHysteresis,
  passesHysteresis,
  selectAccount,
} from "./account-selection.js";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const STATES: ChainAccountState[] = [
  "available",
  "near-limit",
  "limited",
  "login-expired",
  "unknown",
];
const QUALIFYING = new Set<ChainAccountState>([
  "available",
  "near-limit",
  "unknown",
]);
type Until = "none" | "past" | "future";
const UNTILS: Until[] = ["none", "past", "future"];

/** Every tuple of length `n` drawn from `items`. */
function tuples<T>(items: T[], n: number): T[][] {
  if (n === 0) return [[]];
  return tuples(items, n - 1).flatMap((t) => items.map((i) => [...t, i]));
}

/** A distinct time per position so the earliest reset is unambiguous. */
function untilAt(until: Until, index: number): string | null {
  if (until === "none") return null;
  const offset = (index + 1) * HOUR;
  return new Date(
    NOW.getTime() + (until === "past" ? -offset : offset),
  ).toISOString();
}

for (const states of tuples(STATES, 3)) {
  void test(`selection for ${states.join(", ")} with each limitedUntil`, () => {
    for (const untils of tuples(UNTILS, 3)) {
      const chain: ChainCandidate[] = states.map((state, i) => ({
        id: `acct-${i}`,
        state,
        limitedUntil: untilAt(untils[i], i),
      }));
      const winner = chain.findIndex(
        (_, i) => QUALIFYING.has(states[i]) && untils[i] !== "future",
      );
      const result = selectAccount(chain, NOW);
      const label = untils.join(", ");
      if (winner >= 0) {
        assert.deepEqual(
          result,
          { exhausted: false, id: `acct-${winner}` },
          label,
        );
        continue;
      }
      const resets = chain
        .filter((a) => a.state !== "login-expired" && a.limitedUntil !== null)
        .map((a) => a.limitedUntil as string)
        .sort((a, b) => Date.parse(a) - Date.parse(b));
      assert.deepEqual(
        result,
        { exhausted: true, earliestReset: resets[0] ?? null },
        label,
      );
    }
  });
}

void test("login-expired never qualifies, whatever its limitedUntil", () => {
  for (const until of UNTILS) {
    const result = selectAccount(
      [{ id: "a", state: "login-expired", limitedUntil: untilAt(until, 0) }],
      NOW,
    );
    assert.deepEqual(result, { exhausted: true, earliestReset: null });
  }
});

void test("an unknown account qualifies at its position", () => {
  const result = selectAccount(
    [
      { id: "a", state: "limited", limitedUntil: untilAt("future", 0) },
      { id: "b", state: "unknown", limitedUntil: null },
      { id: "c", state: "available", limitedUntil: null },
    ],
    NOW,
  );
  assert.deepEqual(result, { exhausted: false, id: "b" });
});

void test("a future limitedUntil keeps an available account out", () => {
  const result = selectAccount(
    [
      { id: "a", state: "available", limitedUntil: untilAt("future", 0) },
      { id: "b", state: "near-limit", limitedUntil: null },
    ],
    NOW,
  );
  assert.deepEqual(result, { exhausted: false, id: "b" });
});

void test("a limitedUntil equal to now no longer blocks", () => {
  const result = selectAccount(
    [{ id: "a", state: "available", limitedUntil: NOW.toISOString() }],
    NOW,
  );
  assert.deepEqual(result, { exhausted: false, id: "a" });
});

void test("exhausted names the earliest reset across the chain", () => {
  const result = selectAccount(
    [
      { id: "a", state: "limited", limitedUntil: "2026-10-13T08:00:00.000Z" },
      { id: "b", state: "limited", limitedUntil: "2026-10-06T14:30:00.000Z" },
      {
        id: "c",
        state: "near-limit",
        limitedUntil: "2026-10-06T16:00:00.000Z",
      },
      {
        id: "d",
        state: "login-expired",
        limitedUntil: "2026-10-06T13:00:00.000Z",
      },
    ],
    NOW,
  );
  assert.deepEqual(result, {
    exhausted: true,
    earliestReset: "2026-10-06T14:30:00.000Z",
  });
});

void test("an empty chain is exhausted with no reset", () => {
  assert.deepEqual(selectAccount([], NOW), {
    exhausted: true,
    earliestReset: null,
  });
});

const buckets = (...percents: number[]) =>
  percents.map((percent) => ({ percent }));

void test("passesHysteresis with threshold 90 and hysteresis 10 gates on the highest bucket", () => {
  const cases: [number[], ChainAccountState, boolean][] = [
    [[50, 79], "available", true],
    [[79, 85], "available", false],
    [[80], "available", false],
    [[], "unknown", false],
    [[], "available", false],
    [[10], "unknown", false],
  ];
  for (const [percents, state, expected] of cases) {
    assert.equal(
      passesHysteresis(buckets(...percents), state, 90, 10),
      expected,
      `${percents.join(",")} ${state}`,
    );
  }
});

void test("passesHysteresis with hysteresis 0 passes every account, even one never read", () => {
  assert.equal(passesHysteresis([], "unknown", 90, 0), true);
  assert.equal(passesHysteresis(buckets(95), "available", 90, 0), true);
});

void test("filterByHysteresis keeps passing accounts, and with hysteresis 0 returns every input", () => {
  const chain = [
    { id: "low", state: "available", limitedUntil: null, buckets: buckets(50) },
    {
      id: "high",
      state: "available",
      limitedUntil: null,
      buckets: buckets(85),
    },
    { id: "unread", state: "unknown", limitedUntil: null, buckets: [] },
    {
      id: "edge",
      state: "near-limit",
      limitedUntil: null,
      buckets: buckets(89),
    },
  ] satisfies (ChainCandidate & { buckets: { percent: number }[] })[];
  assert.deepEqual(
    filterByHysteresis(chain, 90, 10).map((a) => a.id),
    ["low"],
  );
  assert.deepEqual(filterByHysteresis(chain, 90, 0), chain);
});
