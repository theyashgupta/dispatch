import assert from "node:assert/strict";
import { test } from "node:test";
import { accountName, pendingNote, turnLabel } from "./running-sessions.js";

const accounts = [
  { id: "default", email: "me@home.test", isDefault: true },
  { id: "acc-1", email: "work@corp.test", isDefault: false },
];

test("turn states read in words", () => {
  assert.equal(turnLabel("idle"), "Idle");
  assert.equal(turnLabel("busy"), "Working");
  assert.equal(turnLabel("limit"), "At usage limit");
  assert.equal(turnLabel("unknown"), "Unknown");
});

test("the Default account shows as Default, an added one as its email", () => {
  assert.equal(accountName(accounts, "default"), "Default");
  assert.equal(accountName(accounts, "acc-1"), "work@corp.test");
});

test("an account missing from the list shows as its id", () => {
  assert.equal(accountName(accounts, "gone"), "gone");
});

test("the pending note names the target account", () => {
  assert.equal(
    pendingNote("work@corp.test", false),
    "Moves to work@corp.test after this turn",
  );
  assert.equal(pendingNote("Default", true), "Restarts after this turn");
});
