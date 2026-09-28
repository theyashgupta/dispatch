import test from "node:test";
import assert from "node:assert/strict";
import { createLatestLoader } from "./latest-loader.js";

function harness() {
  const calls: boolean[] = [];
  const resolvers: (() => void)[] = [];
  const busy: boolean[] = [];
  const results: number[] = [];
  const loader = createLatestLoader(
    (fresh) => {
      calls.push(fresh);
      return new Promise<number>((resolve) => {
        resolvers.push(() => resolve(calls.length));
      });
    },
    {
      result: (v) => results.push(v),
      error: () => {},
      busy: (b) => busy.push(b),
    },
  );
  const settle = async () => {
    resolvers.shift()?.();
    await new Promise((r) => setImmediate(r));
  };
  return { loader, calls, busy, results, settle };
}

void test("a fresh request made during a load runs once the load settles, still fresh", async () => {
  const h = harness();
  h.loader.request(false);
  h.loader.request(true);
  assert.deepEqual(h.calls, [false]);
  await h.settle();
  assert.deepEqual(h.calls, [false, true]);
  await h.settle();
  assert.deepEqual(h.results, [1, 2]);
  assert.deepEqual(h.busy, [true, false]);
});

void test("several requests during one load fold into a single follow-up", async () => {
  const h = harness();
  h.loader.request(false);
  h.loader.request(false);
  h.loader.request(true);
  h.loader.request(false);
  await h.settle();
  await h.settle();
  assert.deepEqual(h.calls, [false, true]);
});

void test("a request after the loader goes idle starts immediately", async () => {
  const h = harness();
  h.loader.request(false);
  await h.settle();
  h.loader.request(false);
  assert.deepEqual(h.calls, [false, false]);
  await h.settle();
  assert.deepEqual(h.busy, [true, false, true, false]);
});

void test("a failed load reports the error, clears busy and accepts the next request", async () => {
  const errors: unknown[] = [];
  const busy: boolean[] = [];
  let attempt = 0;
  const loader = createLatestLoader(
    () => {
      attempt++;
      return attempt === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(attempt);
    },
    {
      result: () => {},
      error: (e) => errors.push(e),
      busy: (b) => busy.push(b),
    },
  );
  loader.request(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(errors.length, 1);
  assert.deepEqual(busy, [true, false]);
  loader.request(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(attempt, 2);
  assert.deepEqual(busy, [true, false, true, false]);
});
