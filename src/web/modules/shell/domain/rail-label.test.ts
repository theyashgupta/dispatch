import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardsRailDot,
  boardsRailLabel,
  navRailDot,
  navRailLabel,
  orchestratorRailLabel,
  railLabel,
} from "./rail-label.js";

test("railLabel joins parts and returns the bare label with none", () => {
  assert.equal(railLabel("Inbox", []), "Inbox");
  assert.equal(railLabel("Inbox", ["a", "b"]), "Inbox, a, b");
});

test("railLabel ignores empty parts", () => {
  assert.equal(railLabel("Inbox", ["", "a", ""]), "Inbox, a");
  assert.equal(railLabel("Inbox", [""]), "Inbox");
});

test("boardsRailLabel names the board key and both counts", () => {
  const selected = { key: "LOCAL", loops: 3 };
  assert.equal(
    boardsRailLabel(selected, 2),
    "Boards, LOCAL, 3 live, 2 need you",
  );
  assert.equal(
    boardsRailLabel({ key: "LOCAL", loops: 0 }, 2),
    "Boards, LOCAL, 2 need you",
  );
  assert.equal(boardsRailLabel(selected, 0), "Boards, LOCAL, 3 live");
});

test("boardsRailLabel stays plain when there are no counts", () => {
  assert.equal(boardsRailLabel({ key: "LOCAL", loops: 0 }, 0), "Boards");
  assert.equal(boardsRailLabel(null, 0), "Boards");
});

test("boardsRailLabel omits the key without a selected board", () => {
  assert.equal(boardsRailLabel(null, 2), "Boards, 2 need you");
});

test("orchestratorRailLabel adds the needs-you count only with a badge", () => {
  assert.equal(
    orchestratorRailLabel("Orchestrator", 2),
    "Orchestrator, 2 need you",
  );
  assert.equal(orchestratorRailLabel("Orchestrator", null), "Orchestrator");
  assert.equal(
    orchestratorRailLabel("Add orchestrator", null),
    "Add orchestrator",
  );
});

test("navRailLabel adds a formatted count only when positive", () => {
  assert.equal(navRailLabel("Inbox", 4), "Inbox, 4");
  assert.equal(navRailLabel("Inbox", 0), "Inbox");
  assert.equal(navRailLabel("Inbox", 1500), "Inbox, 1,500");
});

test("boardsRailDot prefers needs-you, then live loops, else none", () => {
  assert.equal(boardsRailDot(3, 2), "accent");
  assert.equal(boardsRailDot(0, 2), "accent");
  assert.equal(boardsRailDot(3, 0), "live");
  assert.equal(boardsRailDot(0, 0), null);
});

test("navRailDot is none without a count, muted when neutral, else accent", () => {
  assert.equal(navRailDot(0, false), null);
  assert.equal(navRailDot(0, true), null);
  assert.equal(navRailDot(4, true), "muted");
  assert.equal(navRailDot(4, false), "accent");
});
