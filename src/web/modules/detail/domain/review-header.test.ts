import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Item } from "../../../../shared/types.js";
import { reviewHeader } from "./review-header.js";

const REVIEW_PR = {
  repo: "acme/api",
  number: 7,
  url: "https://github.com/acme/api/pull/7",
  head: "feature",
  base: "main",
};

function card(extra: Partial<Card> = {}): Card {
  return { reviewPr: REVIEW_PR, ...extra } as Card;
}

function item(checks: string, id = "github:acme/api#7"): Item {
  return { id, meta: { checks } } as unknown as Item;
}

test("a card without reviewPr gives null", () => {
  assert.equal(reviewHeader(card({ reviewPr: undefined }), []), null);
});

test("the label and url come from reviewPr", () => {
  const header = reviewHeader(card(), []);
  assert.equal(header?.label, "PR #7");
  assert.equal(header?.url, REVIEW_PR.url);
  assert.equal(header?.checks, null);
  assert.equal(header?.verdict, null);
});

test("the verdict is read from lastMarker with whitespace collapsed", () => {
  const header = reviewHeader(
    card({
      lastMarker:
        "DONE  Review verdict: approve -\n sandbox review looks fine ",
    }),
    [],
  );
  assert.equal(header?.verdict, "approve - sandbox review looks fine");
});

test("the verdict falls back to statusReason when lastMarker is absent", () => {
  const header = reviewHeader(
    card({ statusReason: "Review verdict: request changes - missing test" }),
    [],
  );
  assert.equal(header?.verdict, "request changes - missing test");
});

test("a marker without the prefix gives no verdict", () => {
  const header = reviewHeader(
    card({ lastMarker: "DONE reviewed the pull request" }),
    [],
  );
  assert.equal(header?.verdict, null);
});

test("checks come from the matching github item", () => {
  const items = [item("pass", "github:acme/api#8"), item("fail")];
  assert.equal(reviewHeader(card(), items)?.checks, "fail");
});

test("checks come from card.prs when no item matches", () => {
  const prs = [{ number: 7, ci: "pending" }] as Card["prs"];
  const header = reviewHeader(card({ prs }), [
    item("pass", "github:acme/api#8"),
  ]);
  assert.equal(header?.checks, "pending");
});

test("an item with empty checks falls back to card.prs", () => {
  const prs = [{ number: 7, ci: "pass" }] as Card["prs"];
  assert.equal(reviewHeader(card({ prs }), [item("")])?.checks, "pass");
});

test("no item and no prs entry gives no checks", () => {
  const prs = [{ number: 9, ci: "pass" }] as Card["prs"];
  assert.equal(reviewHeader(card({ prs }), [])?.checks, null);
});
