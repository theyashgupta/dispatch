import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldSeedDraft } from "./draft-seed.js";

void test("no read yet does not seed", () => {
  assert.equal(shouldSeedDraft(undefined, undefined, false), false);
});

void test("the first read seeds", () => {
  assert.equal(shouldSeedDraft({ days: 3 }, undefined, false), true);
});

void test("the same read object again does not seed", () => {
  const read = { days: 3 };
  assert.equal(shouldSeedDraft(read, read, false), false);
});

void test("a new read while unedited seeds", () => {
  assert.equal(shouldSeedDraft({ days: 4 }, { days: 3 }, false), true);
});

void test("a new read while edited does not seed", () => {
  assert.equal(shouldSeedDraft({ days: 4 }, { days: 3 }, true), false);
});

void test("an equal but new object while unedited seeds", () => {
  assert.equal(shouldSeedDraft({ days: 3 }, { days: 3 }, false), true);
});
