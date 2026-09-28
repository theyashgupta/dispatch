import { test } from "node:test";
import assert from "node:assert/strict";
import { INBOX_SHORTCUTS } from "./shortcuts.js";

test("a is bound in the Inbox table with its label", () => {
  assert.deepEqual(
    INBOX_SHORTCUTS.find((s) => s.key === "a"),
    { key: "a", label: "Ask about this" },
  );
});

test("the Inbox table holds no duplicate keys", () => {
  const keys = INBOX_SHORTCUTS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});
