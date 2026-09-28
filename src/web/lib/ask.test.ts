import { test } from "node:test";
import assert from "node:assert/strict";
import { askAboutQuestion } from "./ask.js";

test("a card target yields the card copy with identifier and title", () => {
  assert.equal(
    askAboutQuestion({
      kind: "card",
      identifier: "LOCAL-921",
      title: "Fix the flaky login test",
    }),
    'Tell me about LOCAL-921 "Fix the flaky login test": what state is it in and what should I do next?',
  );
});

test("an item target yields the item copy with source and humanised type", () => {
  assert.equal(
    askAboutQuestion({
      kind: "item",
      source: "linear",
      typeLabel: "Issue assigned",
      title: "Review the importer",
    }),
    'Tell me about this linear issue assigned "Review the importer": what is it and what should I do next?',
  );
});

test("a leading acronym in the type label is kept", () => {
  assert.match(
    askAboutQuestion({
      kind: "item",
      source: "github",
      typeLabel: "PR review",
      title: "t",
    }),
    /this github PR review "t"/,
  );
});

test("quotes inside a title are kept", () => {
  assert.match(
    askAboutQuestion({
      kind: "card",
      identifier: "LOCAL-1",
      title: 'Rename "old" to "new"',
    }),
    /LOCAL-1 "Rename "old" to "new"":/,
  );
});
