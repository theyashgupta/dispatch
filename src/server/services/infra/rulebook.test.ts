import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRulebook } from "./rulebook.js";

const { markdown, bytes } = await readRulebook();

const HEADINGS = [
  "## 1. Start of a session",
  "## 2. Intake triage",
  "## 3. Playbook judgment",
  "## 4. Grouping",
  "## 5. The plan decision",
  "## 6. Starting work",
  "## 7. Writing a direction",
  "## 8. Monitoring",
  "## 9. Ship procedure",
  "## 10. Release procedure",
  "## 11. Ask the user",
  "## 12. Never",
];

const CRITERIA = [
  "Write code directly: one known fix of a few lines with no new surface",
  "PRD + Ralph Loop: one ticket or one feature of one module, up to a few hundred lines, with phases, QA and a gap analysis",
  "a group with the Roadmap Loop: two or more related tickets with an order or shared files, or any ticket that spans server, web and docs across modules",
  "patch for fixes to released features, minor for a new feature area, major only when the user names it",
];

void test("readRulebook answers the file text and its UTF-8 byte length", () => {
  assert.equal(bytes, Buffer.byteLength(markdown, "utf8"));
  assert.ok(markdown.startsWith("# Orchestration rule book"));
  assert.equal(
    markdown,
    readFileSync(
      new URL("../../../../docs/orchestration/rulebook.md", import.meta.url),
      "utf8",
    ),
  );
});

void test("the rule book holds the 12 section headings", () => {
  for (const heading of HEADINGS) {
    assert.ok(markdown.includes(`\n${heading}\n`), heading);
  }
});

void test("the rule book holds the four verbatim criteria", () => {
  for (const criterion of CRITERIA) {
    assert.ok(markdown.includes(criterion), criterion);
  }
});

void test("the rule book has no em dash, no double hyphen, no user path and no status marker", () => {
  assert.equal(markdown.includes(String.fromCharCode(0x2014)), false);
  assert.equal(markdown.includes("-".repeat(2)), false);
  assert.equal(markdown.includes("/Users/"), false);
  assert.equal(markdown.includes("DISPATCH_STATUS"), false);
});

void test("the rule book names get_card_progress and the single card handoff, and not supervisor_state", () => {
  assert.ok(markdown.includes("get_card_progress"));
  assert.ok(
    markdown.includes(
      "For a group or a single card at the handoff percent, call `request_handoff`.",
    ),
  );
  assert.equal(markdown.includes("supervisor_state"), false);
});

void test("the rule book names release_prep, list_accounts and start_ship for a single card, and no decision item for a single ship or a release", () => {
  for (const text of [
    "release_prep",
    "list_accounts",
    "`account`",
    "Release playbook",
    "send_input",
    "Never choose usage credits",
    "Ship a single card that `start_card` started",
  ]) {
    assert.ok(markdown.includes(text), text);
  }
  for (const text of ["works on group cards only", "has no release tool"]) {
    assert.equal(markdown.includes(text), false, text);
  }
});

void test("the rule book tells the orchestrator to read get_policy before it sends the ship rights to the release session", () => {
  assert.ok(markdown.includes("call `get_policy`. Then call `send_input`"));
});
