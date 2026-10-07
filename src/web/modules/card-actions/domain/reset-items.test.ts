import assert from "node:assert/strict";
import { test } from "node:test";
import { resetItems } from "./reset-items.js";

test("a started card lists the session, the folder and the branch", () => {
  assert.deepEqual(
    resetItems({
      tmuxSession: "dsp-A-1",
      workspacePath: "/w/A-1",
      branch: "a-1/work",
    }),
    ["The Claude session", "Workspace folder /w/A-1", "Local branch a-1/work"],
  );
});

test("a lost session still counts as a session", () => {
  assert.deepEqual(resetItems({ sessionLost: true }), ["The Claude session"]);
});

test("a card with nothing started lists nothing", () => {
  assert.deepEqual(resetItems({}), []);
});

test("a card with several sessions gets the two summary lines", () => {
  assert.deepEqual(
    resetItems({ sessionCount: 3, tmuxSession: "dsp-A-1", branch: "b" }),
    ["3 Claude sessions", "Each session's workspace folder and local branch"],
  );
});
