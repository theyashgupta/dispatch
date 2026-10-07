import assert from "node:assert/strict";
import { test } from "node:test";
import { groupStartFailure, startFailure } from "./start-copy.js";

const members = [
  { id: "a", identifier: "G-4" },
  { id: "b", identifier: "G-5" },
  { id: "c", identifier: "G-6" },
];

test("a config refusal keeps the config variant and the server text", () => {
  assert.deepEqual(startFailure({ error: "repo gone", variant: "config" }), {
    variant: "config",
    text: "repo gone",
  });
});

test("a playbook refusal keeps the playbook variant for its own copy", () => {
  assert.deepEqual(startFailure({ error: "x", variant: "playbook" }), {
    variant: "playbook",
    text: "x",
  });
});

test("a plain 400 shows the server text with no variant", () => {
  assert.deepEqual(startFailure({ error: "stub validation error" }), {
    variant: null,
    text: "stub validation error",
  });
});

test("an unknown variant shows the server text with no variant", () => {
  assert.deepEqual(startFailure({ error: "x", variant: "other" }), {
    variant: null,
    text: "x",
  });
});

test("a single ineligible member reads as it", () => {
  assert.deepEqual(
    groupStartFailure(
      { error: "x", variant: "ineligible", ineligibleIds: ["a"] },
      members,
    ),
    {
      variant: "ineligible",
      text: "No longer eligible: G-4. Remove it and try again.",
    },
  );
});

test("two ineligible members read as them", () => {
  assert.equal(
    groupStartFailure(
      { error: "x", variant: "ineligible", ineligibleIds: ["a", "b"] },
      members,
    ).text,
    "No longer eligible: G-4, G-5. Remove them and try again.",
  );
});

test("an ineligible refusal with no matching member shows the server text", () => {
  assert.equal(
    groupStartFailure(
      {
        error: "some selected cards are no longer eligible",
        variant: "ineligible",
        ineligibleIds: [],
      },
      members,
    ).text,
    "some selected cards are no longer eligible",
  );
  assert.equal(
    groupStartFailure(
      { error: "server text", variant: "ineligible", ineligibleIds: ["zzz"] },
      members,
    ).text,
    "server text",
  );
});

test("a group refusal that is not ineligible maps like a card refusal", () => {
  assert.deepEqual(
    groupStartFailure({ error: "x", variant: "config" }, members),
    { variant: "config", text: "x" },
  );
});
