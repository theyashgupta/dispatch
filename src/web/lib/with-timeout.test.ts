import assert from "node:assert/strict";
import { test } from "node:test";
import { withTimeout } from "./with-timeout.js";

void test("withTimeout resolves the value when the promise wins", async () => {
  assert.equal(await withTimeout(Promise.resolve("list"), 1000), "list");
});

void test("withTimeout resolves undefined when the timer wins and ignores a late value", async () => {
  let release: (value: string) => void = () => undefined;
  const slow = new Promise<string>((resolve) => {
    release = resolve;
  });
  assert.equal(await withTimeout(slow, 5), undefined);
  release("late");
  await slow;
  assert.equal(await withTimeout(slow, 0), "late");
});

void test("withTimeout lets an already resolved promise win a 0 ms race", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 0), 7);
});
