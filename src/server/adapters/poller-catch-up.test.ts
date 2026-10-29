import assert from "node:assert/strict";
import { afterEach, test, type TestContext } from "node:test";
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

function calendarLike(fetch: () => Promise<typeof ok>, id = "calendar-like") {
  let fetches = 0;
  const source = makeFakeSource({
    id,
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

/**
 * Mock the timers and skew `Date.now` apart from them, the way a Mac sleep moves the wall clock.
 *
 * @returns A function that jumps the wall clock forward without firing any timer.
 */
function sleepClock(t: TestContext): (ms: number) => void {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const realNow = Date.now.bind(Date);
  let skew = 0;
  t.mock.method(Date, "now", () => realNow() + skew);
  return (ms) => {
    skew += ms;
  };
}

test("a wall clock jump of three intervals runs once at the next check, then the loop keeps its interval", async (t) => {
  const sleep = sleepClock(t);
  const c = calendarLike(() => Promise.resolve(ok), "slept");
  startPollers([c.source]);
  await flush();
  t.mock.timers.tick(CATCH_UP);
  assert.equal(c.fetches(), 1, "no catch-up while the wall clock keeps pace");
  sleep(INTERVAL * 3);
  t.mock.timers.tick(CATCH_UP);
  assert.equal(c.fetches(), 2, "the slept gap runs once at the next check");
  await flush();
  t.mock.timers.tick(INTERVAL - 1);
  assert.equal(c.fetches(), 2, "the catch-up returns to the regular interval");
  t.mock.timers.tick(1);
  assert.equal(c.fetches(), 3);
});

test("a wake catch-up in progress is not started again by a second jump", async (t) => {
  const sleep = sleepClock(t);
  let resolve: (r: typeof ok) => void = () => {};
  let calls = 0;
  const c = calendarLike(() => {
    calls += 1;
    return calls === 1
      ? Promise.resolve(ok)
      : new Promise((res) => {
          resolve = res;
        });
  }, "slept-in-flight");
  startPollers([c.source]);
  await flush();
  sleep(INTERVAL * 3);
  t.mock.timers.tick(CATCH_UP);
  assert.equal(c.fetches(), 2, "the catch-up starts");
  sleep(INTERVAL * 3);
  t.mock.timers.tick(INTERVAL * 3);
  assert.equal(
    c.fetches(),
    2,
    "no second fetch while the catch-up is in flight",
  );
  resolve(ok);
  await flush();
  t.mock.timers.tick(INTERVAL - 1);
  assert.equal(c.fetches(), 2, "a settled run waits a full interval");
  t.mock.timers.tick(1);
  assert.equal(c.fetches(), 3);
});
