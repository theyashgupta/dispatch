import assert from "node:assert/strict";
import { test } from "node:test";
import { cardPrs } from "./card-prs.js";
import type { Card, PrInfo } from "./types.js";

function pr(number: number, extra: Partial<PrInfo> = {}): PrInfo {
  return {
    number,
    url: `https://example.test/pr/${number}`,
    title: `PR ${number}`,
    state: "open",
    isDraft: false,
    ci: null,
    repo: "frontend",
    ...extra,
  };
}

function card(extra: Record<string, unknown>): Card {
  return { id: "c1", ...extra } as unknown as Card;
}

test("a card with no PRs lists none", () => {
  assert.deepEqual(cardPrs(card({})), []);
});

test("PRs from the active session and sibling sessions are unioned", () => {
  const merged = cardPrs(
    card({
      prs: [pr(1)],
      sessionSummaries: [{ prs: [pr(2)] }, {}],
    }),
  );
  assert.deepEqual(
    merged.map((p) => p.number),
    [2, 1],
  );
});

test("a PR url seen twice is kept once, first occurrence wins", () => {
  const merged = cardPrs(
    card({
      prs: [pr(1, { title: "first" })],
      sessionSummaries: [{ prs: [pr(1, { title: "second" })] }],
    }),
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.title, "first");
});

test("PRs sort open, draft, merged, closed, then by number descending", () => {
  const merged = cardPrs(
    card({
      prs: [
        pr(1, { state: "closed" }),
        pr(2, { state: "merged" }),
        pr(3, { isDraft: true }),
        pr(4),
        pr(5),
      ],
    }),
  );
  assert.deepEqual(
    merged.map((p) => p.number),
    [5, 4, 3, 2, 1],
  );
});

test("a draft flag outranks the stored state", () => {
  const merged = cardPrs(
    card({
      prs: [
        pr(1, { state: "merged", isDraft: true }),
        pr(2, { state: "merged" }),
      ],
    }),
  );
  assert.deepEqual(
    merged.map((p) => p.number),
    [1, 2],
  );
});

test("a state outside the union ranks as closed and keeps the order total", () => {
  const unknown = pr(9, { state: "weird" as PrInfo["state"] });
  const merged = cardPrs(
    card({
      prs: [unknown, pr(1, { state: "merged" }), pr(2, { state: "closed" })],
    }),
  );
  assert.deepEqual(
    merged.map((p) => p.number),
    [1, 9, 2],
  );
});
