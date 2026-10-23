import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import { makeFakeSource } from "../test-support/fake-source.js";
import type { SourceIssue } from "../../shared/types.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { startPollers, stopPollers } = await import("./poller.js");
await store.load();

afterEach(() => stopPollers());

const INTERVAL = 300_000;
const CATCH_UP = 30_000;
const flush = () => new Promise((r) => setImmediate(r));
const ok = { issues: [] as SourceIssue[], truncated: false };

function calendarLike(fetch: () => Promise<typeof ok>) {
  let fetches = 0;
  const source = makeFakeSource({
    id: "calendar-like",
    itemsOnly: true,
    pollIntervalMs: INTERVAL,
    fetch: () => {
      fetches += 1;
      return fetch();
    },
  });
  return { source, fetches: () => fetches };
}

test("a missed run reruns once after the catch-up delay, then the loop keeps its interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fail = true;
  const c = calendarLike(() =>
    fail
      ? Promise.reject(new Error("calendar read failed"))
      : Promise.resolve(ok),
  );
  startPollers([c.source]);
  await flush();
  assert.equal(c.fetches(), 1);
  fail = false;
  t.mock.timers.tick(CATCH_UP - 1);
  assert.equal(c.fetches(), 1, "no rerun before the catch-up delay");
  t.mock.timers.tick(1);
  assert.equal(c.fetches(), 2, "the missed run reruns once");
  await flush();
  t.mock.timers.tick(INTERVAL - 1);
  assert.equal(c.fetches(), 2, "a success returns to the regular interval");
  t.mock.timers.tick(1);
  assert.equal(c.fetches(), 3);
});

test("two misses in a row rerun once, not twice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const c = calendarLike(() => Promise.reject(new Error("still failing")));
  startPollers([c.source]);
  await flush();
  t.mock.timers.tick(CATCH_UP);
  assert.equal(c.fetches(), 2, "first miss reruns once");
  await flush();
  t.mock.timers.tick(INTERVAL - 1);
  assert.equal(c.fetches(), 2, "the failed rerun waits a full interval");
  t.mock.timers.tick(1);
  assert.equal(c.fetches(), 3);
  await flush();
  t.mock.timers.tick(CATCH_UP);
  assert.equal(c.fetches(), 3, "no second catch-up in the same failure streak");
});

test("a run in progress is not started again by later ticks", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reject: (e: Error) => void = () => {};
  const c = calendarLike(
    () =>
      new Promise((_, rej) => {
        reject = rej;
      }),
  );
  startPollers([c.source]);
  await flush();
  t.mock.timers.tick(INTERVAL * 3);
  assert.equal(c.fetches(), 1, "no second fetch while one is in flight");
  reject(new Error("overran and failed"));
  await flush();
  t.mock.timers.tick(CATCH_UP);
  assert.equal(c.fetches(), 2, "the overrun run reruns once after it settles");
});
