import test from "node:test";
import assert from "node:assert/strict";
import { createTtlCache } from "./ttl-cache.js";

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

void test("a value is served before its TTL ends", () => {
  const c = clock();
  const cache = createTtlCache<number>(300, c.now);
  cache.set("a", 1);
  c.advance(299);
  assert.equal(cache.get("a"), 1);
});

void test("a value is stale at exactly the TTL and after it", () => {
  const c = clock();
  const cache = createTtlCache<number>(300, c.now);
  cache.set("a", 1);
  c.advance(300);
  assert.equal(cache.get("a"), undefined);
  cache.set("b", 2);
  c.advance(301);
  assert.equal(cache.get("b"), undefined);
});

void test("clear drops every entry", () => {
  const c = clock();
  const cache = createTtlCache<number>(300, c.now);
  cache.set("a", 1);
  cache.clear();
  assert.equal(cache.get("a"), undefined);
});

void test("keys expire independently", () => {
  const c = clock();
  const cache = createTtlCache<string>(300, c.now);
  cache.set("a", "x");
  c.advance(200);
  cache.set("b", "y");
  c.advance(150);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), "y");
});
