import assert from "node:assert/strict";
import { test } from "node:test";
import { SlackThreadCache } from "./slack-thread.js";

const thread = (text: string) => ({
  messages: [{ author: "ana", time: "2023-11-14T22:15:00.000Z", text }],
  truncated: false,
});

test("an entry younger than 600000 ms is a hit", () => {
  let now = 1_000;
  const cache = new SlackThreadCache(() => now);
  cache.set("C0C1:1700000100.000100", thread("a"));
  now += 599_999;
  assert.deepEqual(cache.get("C0C1:1700000100.000100"), thread("a"));
});

test("an entry exactly 600000 ms old is a miss", () => {
  let now = 1_000;
  const cache = new SlackThreadCache(() => now);
  cache.set("C0C1:1700000100.000100", thread("a"));
  now += 600_000;
  assert.equal(cache.get("C0C1:1700000100.000100"), undefined);
});

test("the 201st insert evicts the oldest entry", () => {
  const cache = new SlackThreadCache(() => 0);
  for (let i = 0; i <= 200; i += 1) cache.set(`k${i}`, thread(String(i)));
  assert.equal(cache.get("k0"), undefined);
  assert.deepEqual(cache.get("k1"), thread("1"));
  assert.deepEqual(cache.get("k200"), thread("200"));
});
