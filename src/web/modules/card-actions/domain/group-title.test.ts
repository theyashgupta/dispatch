import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../../../shared/types.js";
import {
  composeGroupTitle,
  deterministicGroupTitle,
  shouldAcceptGeneratedPhrase,
  type TitleCaret,
} from "./group-title.js";

function member(
  identifier: string,
  project?: { id: string; name: string } | null,
): Card {
  return { id: identifier, identifier, project } as Card;
}

const alpha = { id: "p1", name: "Alpha" };

test("the deterministic title is the shared project name with the member bracket", () => {
  assert.equal(
    deterministicGroupTitle([member("A-1", alpha), member("A-2", alpha)]),
    "Alpha [2: A-1, A-2]",
  );
});

test("the deterministic title is the bracket alone when the projects differ", () => {
  assert.equal(
    deterministicGroupTitle([
      member("A-1", alpha),
      member("A-2", { id: "p2", name: "Beta" }),
    ]),
    "[2: A-1, A-2]",
  );
});

test("the deterministic title is the bracket alone when a member has no project", () => {
  assert.equal(
    deterministicGroupTitle([member("A-1", alpha), member("A-2")]),
    "[2: A-1, A-2]",
  );
});

test("the deterministic title collapses whitespace in the project name", () => {
  assert.equal(
    deterministicGroupTitle([
      member("A-1", { id: "p1", name: "Big\n  Project" }),
    ]),
    "Big Project [1: A-1]",
  );
});

test("the deterministic title of no members is the empty bracket", () => {
  assert.equal(deterministicGroupTitle([]), "[0: ]");
});

test("the composed title joins the phrase and the member identifiers", () => {
  assert.equal(
    composeGroupTitle("  Fix login  ", [member("A-1"), member("A-2")]),
    "Fix login [2: A-1, A-2]",
  );
});

test("the composed title without a phrase has no leading space", () => {
  assert.equal(composeGroupTitle("   ", [member("A-1")]), "[1: A-1]");
});

test("the composed title falls back to the count when the identifiers do not fit", () => {
  const members = Array.from({ length: 12 }, (_, i) =>
    member(`PROP-${1000 + i}`),
  );
  assert.equal(
    composeGroupTitle("Fix login", members),
    "Fix login [12 tickets]",
  );
});

test("the composed title cuts a long phrase with an ellipsis", () => {
  const title = composeGroupTitle("x".repeat(100), [member("A-1")]);
  assert.equal(title, `${"x".repeat(55)}… [1: A-1]`);
});

test("the composed title counts an emoji as two units and never splits it", () => {
  const title = composeGroupTitle("😀".repeat(40), [member("A-1")]);
  const phrase = title.slice(0, title.indexOf(" ["));
  assert.equal([...phrase].length, 28);
  assert.ok(phrase.endsWith("…"));
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(phrase));
});

const caret = (start: number | null, end: number | null, length = 10) =>
  ({ selectionStart: start, selectionEnd: end, length }) satisfies TitleCaret;

test("a generated phrase is refused after the user typed", () => {
  assert.equal(shouldAcceptGeneratedPhrase(true, null), false);
});

test("a generated phrase is accepted while the input has no focus", () => {
  assert.equal(shouldAcceptGeneratedPhrase(false, null), true);
});

test("a generated phrase is accepted with the caret at either edge", () => {
  assert.equal(shouldAcceptGeneratedPhrase(false, caret(0, 0)), true);
  assert.equal(shouldAcceptGeneratedPhrase(false, caret(10, 10)), true);
});

test("a generated phrase is refused with the caret inside the text", () => {
  assert.equal(shouldAcceptGeneratedPhrase(false, caret(4, 4)), false);
});

test("a generated phrase is refused with a selection", () => {
  assert.equal(shouldAcceptGeneratedPhrase(false, caret(0, 10)), false);
});

test("a generated phrase is accepted when the selection is unreadable", () => {
  assert.equal(shouldAcceptGeneratedPhrase(false, caret(null, null)), true);
});
