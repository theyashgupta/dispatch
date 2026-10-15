import { test } from "node:test";
import assert from "node:assert/strict";
import { initialHash } from "./route.js";

test("a present hash wins over everything stored", () => {
  assert.equal(initialHash("#/inbox", "#/activity"), "#/inbox");
});

test("an empty hash falls back to the remembered route", () => {
  assert.equal(initialHash("", "#/inbox"), "#/inbox");
  assert.equal(initialHash("#", "#/settings/vault"), "#/settings/vault");
});

test("an old workspace or orca hash opens the board", () => {
  assert.equal(initialHash("#/workspace", null), "#/board");
  assert.equal(initialHash("#/workspace/X", null), "#/board");
  assert.equal(initialHash("#/orca", null), "#/board");
});

test("a stored route still wins over an empty hash", () => {
  assert.equal(initialHash("#/", "#/activity"), "#/activity");
});

test("a stored route that does not parse falls back to the board", () => {
  assert.equal(initialHash("", "#/nope"), "#/board");
  assert.equal(initialHash("", "garbage"), "#/board");
});

test("nothing stored and no hash lands on the board", () => {
  assert.equal(initialHash("", null), "#/board");
});

test("an unknown current hash is normalized to the board, not left as is", () => {
  assert.equal(initialHash("#/nope", "#/inbox"), "#/board");
});

test("a current hash keeps its board query", () => {
  assert.equal(initialHash("#/board?board=ACME", null), "#/board?board=ACME");
});

test("a current hash with an id keeps the id and the query", () => {
  assert.equal(
    initialHash("#/inbox/abc?board=ACME", "#/activity"),
    "#/inbox/abc?board=ACME",
  );
});

test("an unknown page with a query maps to the board with the same query", () => {
  assert.equal(
    initialHash("#/nope?board=ACME", "#/inbox"),
    "#/board?board=ACME",
  );
});

test("a keyed board path keeps its segments on first load", () => {
  assert.equal(
    initialHash("#/boards/ACME/settings", null),
    "#/boards/ACME/settings",
  );
  assert.equal(
    initialHash("#/boards/ACME/settings?x=1", "#/inbox"),
    "#/boards/ACME/settings?x=1",
  );
  assert.equal(
    initialHash("#/boards/ACME/inbox?x=1", null),
    "#/boards/ACME/inbox?x=1",
  );
});

test("a pull request id with a slash stays one encoded id", () => {
  assert.equal(
    initialHash("#/pull-requests/org%2Frepo%2342", null),
    "#/pull-requests/org%2Frepo%2342",
  );
});
