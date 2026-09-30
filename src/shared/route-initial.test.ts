import { test } from "node:test";
import assert from "node:assert/strict";
import { initialHash } from "./route.js";

test("a present hash wins over everything stored", () => {
  assert.equal(initialHash("#/inbox", "#/activity", "workspace"), "#/inbox");
});

test("an empty hash falls back to the remembered route", () => {
  assert.equal(initialHash("", "#/inbox", null), "#/inbox");
  assert.equal(initialHash("#", "#/settings/vault", null), "#/settings/vault");
});

test("legacy dsp.view workspace maps to the workspace page when nothing is stored", () => {
  assert.equal(initialHash("", null, "workspace"), "#/workspace");
  assert.equal(initialHash("#/", null, "orca"), "#/workspace");
});

test("a stored route that does not parse falls back to the board", () => {
  assert.equal(initialHash("", "#/nope", null), "#/board");
  assert.equal(initialHash("", "garbage", null), "#/board");
});

test("nothing stored and no hash lands on the board", () => {
  assert.equal(initialHash("", null, null), "#/board");
  assert.equal(initialHash("", null, "board"), "#/board");
});

test("an unknown current hash is normalized to the board, not left as is", () => {
  assert.equal(initialHash("#/nope", "#/inbox", null), "#/board");
});
