import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey } from "../../../../shared/types.js";
import { archiveAction, keyClash } from "./board-archive.js";

const local = { key: "LOCAL" as BoardKey };
const acme = { key: "ACME" as BoardKey };

test("the default board has no archive item", () => {
  assert.deepEqual(archiveAction(local, 0), { kind: "none" });
  assert.deepEqual(archiveAction(local, 2), { kind: "none" });
});

test("a board with no running session can archive", () => {
  assert.deepEqual(archiveAction(acme, 0), { kind: "enabled" });
});

test("running sessions disable the archive item with the reason", () => {
  assert.deepEqual(archiveAction(acme, 2), {
    kind: "disabled",
    reason: "Stop the 2 running sessions first.",
  });
});

test("a single running session disables the archive item", () => {
  const action = archiveAction(acme, 1);
  assert.equal(action.kind, "disabled");
  assert.equal(
    action.kind === "disabled" ? action.reason : "",
    "Stop the 1 running session first.",
  );
});

test("keyClash needs a known Linear team key and a non-default board", () => {
  assert.equal(keyClash(acme, ["ACME", "ENG"]), true);
  assert.equal(keyClash(acme, ["ENG"]), false);
  assert.equal(keyClash(local, ["LOCAL"]), false);
});
