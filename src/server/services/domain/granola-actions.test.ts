import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGranolaPrompt,
  granolaToolName,
  groupByMeeting,
  nextRunDelay,
  parseMcpList,
  roundSince,
} from "./granola-actions.js";
import { buildMeetingItems, parseActionItems } from "./meeting-actions.js";

const MACHINE_LIST = [
  "Checking MCP server health…",
  "",
  "claude.ai Claude Docs: https://docs.example/mcp - ✔ Connected",
  "plugin:chrome-devtools-mcp:chrome-devtools: npx chrome-devtools-mcp@1.9.0 - ✔ Connected",
  "plugin:claude-mem:mcp-search: node -e const f=require('fs');f.granola=1 - ✔ Connected",
  "plugin:design:slack: https://mcp.slack.example/mcp (HTTP) - ! Needs authentication",
  "plugin:design:asana: https://mcp.asana.example/sse (HTTP) - ✘ Failed to connect - Incompatible auth server",
  "plugin:design:google calendar:  (HTTP) - - Not configured",
  "playwright: npx -y @playwright/mcp@latest - ✔ Connected",
].join("\n");

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-25T12:00:00.000Z");

function withGranola(line: string): string {
  return `${MACHINE_LIST}\n${line}\n`;
}

test("this machine's list plus a connected Granola line parses to connected", () => {
  const check = parseMcpList(
    withGranola(
      "claude.ai Granola: https://mcp.granola.ai/mcp (HTTP) - ✔ Connected",
    ),
  );
  assert.deepEqual(check, { state: "connected", server: "claude.ai Granola" });
  assert.equal(granolaToolName(check.server ?? ""), "mcp__claude_ai_Granola");
});

test("the list without Granola is not-found, even when a command mentions granola", () => {
  assert.deepEqual(parseMcpList(MACHINE_LIST), { state: "not-found" });
});

test("a Needs authentication line is needs-auth and any other state is failed", () => {
  assert.deepEqual(
    parseMcpList(
      withGranola(
        "claude.ai Granola: https://mcp.granola.ai/mcp (HTTP) - ! Needs authentication",
      ),
    ),
    { state: "needs-auth", server: "claude.ai Granola" },
  );
  assert.deepEqual(
    parseMcpList(
      withGranola(
        "granola: https://mcp.granola.ai/mcp (HTTP) - ✘ Failed to connect",
      ),
    ),
    { state: "failed", server: "granola" },
  );
});

test("granolaToolName replaces every character outside the tool name set", () => {
  assert.equal(
    granolaToolName("my granola.v2 (work)"),
    "mcp__my_granola_v2__work_",
  );
  assert.equal(granolaToolName("granola-x_1"), "mcp__granola-x_1");
});

test("the Granola prompt carries the contract lines in order", () => {
  const since = new Date("2026-09-23T12:00:00.000Z");
  const lines = buildGranolaPrompt(since, NOW).split("\n");
  assert.deepEqual(lines, [
    "You are extracting the user's action items from their recent Granola meetings for Dispatch, a local task board.",
    "Use the Granola tools to list the meetings between 2026-09-23T12:00:00.000Z and 2026-09-25T12:00:00.000Z and read their notes.",
    "List only the action items that belong to the user: commitments the user made, questions directed at the user, and decisions the user must act on. Skip items owned by other people.",
    "",
    "Output rules (follow exactly):",
    "- Output only repeated sections, at most 15 in total, with no preamble, no closing remarks and no code fence.",
    "- Each section starts with the literal line: ## Action item",
    "- Then the line key: <a short kebab-case slug of the action's subject, lowercase letters, digits and hyphens only, at most 48 characters; reuse the same key for the same action on every run>",
    "- Then the line title: <one plain-text sentence under 120 characters that starts with a verb>",
    "- Then the line meeting: <the meeting title exactly as Granola shows it>",
    "- Then the line date: <the meeting date as YYYY-MM-DD>",
    "- Then the line link: <the Granola URL of the meeting, or none>",
    "- Then a blank line and one sentence of context from the meeting.",
    "- If no meeting in that range holds an action item for the user, output exactly: NO_ACTION_ITEMS",
    "- If the Granola tools are not available, output exactly: GRANOLA_UNAVAILABLE",
    '- Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.',
  ]);
});

test("a success 20 minutes ago resumes 50 minutes back and waits 40 minutes", () => {
  const polledAt = new Date(NOW.getTime() - 20 * 60 * 1000).toISOString();
  const { since, until } = roundSince({ cursor: polledAt, polledAt }, 48, NOW);
  assert.equal(since.getTime(), NOW.getTime() - 50 * 60 * 1000);
  assert.equal(until, NOW);
  assert.equal(nextRunDelay(polledAt, NOW), 40 * 60 * 1000);
});

test("a success 3 days ago falls back to the 48 hour window and is due now", () => {
  const polledAt = new Date(NOW.getTime() - 72 * HOUR).toISOString();
  const { since } = roundSince({ cursor: polledAt, polledAt }, 48, NOW);
  assert.equal(since.getTime(), NOW.getTime() - 48 * HOUR);
  assert.equal(nextRunDelay(polledAt, NOW), 0);
});

test("no cursor reads the whole window and is due now", () => {
  assert.equal(
    roundSince(undefined, 336, NOW).since.getTime(),
    NOW.getTime() - 336 * HOUR,
  );
  assert.equal(nextRunDelay(undefined, NOW), 0);
  assert.equal(nextRunDelay("not a date", NOW), 0);
});

const FOUR_SECTIONS = [
  "## Action item",
  "key: send-deck",
  "title: Send the deck",
  "meeting: Planning",
  "date: 2026-09-24",
  "link: https://notes.granola.ai/d/1",
  "",
  "Sam promised the deck zebra-canary-7.",
  "## Action item",
  "key: book-room",
  "title: Book the room",
  "meeting: Planning",
  "date: 2026-09-24",
  "link: none",
  "",
  "Sam books the room.",
  "## Action item",
  "key: review-pr",
  "title: Review the PR",
  "meeting: Standup",
  "date: 2026-09-25",
  "link: none",
  "",
  "Sam reviews the PR.",
  "## Action item",
  "key: no-meeting",
  "title: Drop this one",
  "date: 2026-09-25",
  "",
  "No meeting line.",
].join("\n");

test("four sections across two meetings give two sibling groups and drop the one with no meeting", () => {
  const groups = groupByMeeting(parseActionItems(FOUR_SECTIONS), "2026-09-25");
  assert.deepEqual(
    groups.map((g) => [g.meeting, g.meetingDate, g.drafts.map((d) => d.key)]),
    [
      ["Planning", "2026-09-24", ["send-deck", "book-room"]],
      ["Standup", "2026-09-25", ["review-pr"]],
    ],
  );
  const planning = buildMeetingItems({
    feed: "granola",
    ...groups[0],
    now: NOW.toISOString(),
  });
  assert.deepEqual(JSON.parse(planning[0].meta.siblings), ["Book the room"]);
  assert.equal(planning[0].url, "https://notes.granola.ai/d/1");
  assert.equal(planning[1].url, undefined);
});

test("a missing or malformed date takes the fallback date", () => {
  const groups = groupByMeeting(
    [
      { key: "a", title: "A", description: "d", meeting: "M" },
      { key: "b", title: "B", description: "d", meeting: "M", date: "24/09" },
    ],
    "2026-09-25",
  );
  assert.deepEqual(
    groups.map((g) => [g.meetingDate, g.drafts.length]),
    [["2026-09-25", 2]],
  );
});

test("the same key in two meetings survives parsing and lands as two items", () => {
  const out = [
    "## Action item",
    "key: send-report",
    "title: Send the report",
    "meeting: Weekly sync",
    "date: 2026-09-18",
    "link: none",
    "",
    "Week one.",
    "## Action item",
    "key: send-report",
    "title: Send the report",
    "meeting: Weekly sync",
    "date: 2026-09-25",
    "link: none",
    "",
    "Week two.",
    "## Action item",
    "key: send-report",
    "title: Send the report again",
    "meeting: Weekly sync",
    "date: 2026-09-25",
    "link: none",
    "",
    "A true duplicate.",
  ].join("\n");
  const groups = groupByMeeting(parseActionItems(out), "2026-09-25");
  assert.deepEqual(
    groups.map((g) => [g.meetingDate, g.drafts.map((d) => d.description)]),
    [
      ["2026-09-18", ["Week one."]],
      ["2026-09-25", ["Week two."]],
    ],
  );
});

test("meetings group case-insensitively and a key maps to one item even when dates fall back", () => {
  const groups = groupByMeeting(
    [
      {
        key: "a",
        title: "A",
        description: "d",
        meeting: "Weekly Sync",
        date: "x",
      },
      { key: "a", title: "A2", description: "d", meeting: "weekly sync " },
      { key: "b", title: "B", description: "d", meeting: "weekly sync" },
    ],
    "2026-09-25",
  );
  assert.deepEqual(
    groups.map((g) => [g.meeting, g.drafts.map((d) => d.title)]),
    [["Weekly Sync", ["A", "B"]]],
  );
});

test("a future polledAt falls back to the whole window", () => {
  const future = new Date(NOW.getTime() + 2 * HOUR).toISOString();
  const { since, until } = roundSince(
    { cursor: future, polledAt: future },
    48,
    NOW,
  );
  assert.equal(since.getTime(), NOW.getTime() - 48 * HOUR);
  assert.equal(until, NOW);
});

test("the first Granola line wins when mcp list shows two", () => {
  assert.deepEqual(
    parseMcpList(
      withGranola(
        "granola-old: https://old.example/mcp (HTTP) - ✘ Failed to connect\nclaude.ai Granola: https://mcp.granola.ai/mcp (HTTP) - ✔ Connected",
      ),
    ),
    { state: "failed", server: "granola-old" },
  );
});
