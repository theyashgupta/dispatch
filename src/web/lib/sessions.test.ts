import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, SessionSummary } from "../../shared/types.js";
import {
  flattenSessions,
  formatElapsed,
  sessionSection,
  sessionStatusLabel,
  type SessionRow,
} from "./sessions.js";

const NOW = Date.parse("2026-09-24T12:00:00.000Z");

function summary(
  id: string,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id,
    ordinal: 1,
    lost: false,
    active: true,
    createdAt: "2026-09-24T10:00:00.000Z",
    updatedAt: "2026-09-24T11:30:00.000Z",
    ...extra,
  };
}

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    issueId: id,
    identifier: id,
    title: `Card ${id}`,
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-09-24T11:30:00.000Z",
    ...extra,
  };
}

test("three cards with 1, 2 and 0 summaries yield 3 rows, each summary once, the active one marked", () => {
  const rows = flattenSessions(
    [
      card("LOCAL-1", { sessionSummaries: [summary("s1")] }),
      card("LOCAL-2", {
        sessionSummaries: [
          summary("s2a", { active: false, ordinal: 1 }),
          summary("s2b", { ordinal: 2 }),
        ],
      }),
      card("LOCAL-3"),
    ],
    NOW,
  );
  assert.deepEqual(
    rows.map((r) => [r.key, r.active, r.siblings]),
    [
      ["LOCAL-1:s1", true, 1],
      ["LOCAL-2:s2a", false, 2],
      ["LOCAL-2:s2b", true, 2],
    ],
  );
});

test("row fields come from the card and the summary", () => {
  const [row] = flattenSessions(
    [
      card("LOCAL-7", {
        title: "Fix the sync",
        startIntent: { playbook: "bugfix" },
        sessionSummaries: [
          summary("abcdefgh-1234", {
            claudeAccountId: "acct-a",
            branch: "dispatch/LOCAL-7",
            workspaceFolder: "acme-app",
            lastMarker: "NEEDS_INPUT",
            prs: [{ url: "https://x/pr/1" } as never],
            cleanupBlocked: [{ repo: "web", count: 2 }],
          }),
        ],
      }),
    ],
    NOW,
  );
  assert.equal(row?.shortId, "abcdefgh");
  assert.equal(row?.playbook, "bugfix");
  assert.equal(row?.account, "acct-a");
  assert.equal(row?.worktree, "acme-app · dispatch/LOCAL-7");
  assert.equal(row?.lastMarker, "NEEDS_INPUT");
  assert.equal(row?.prs.length, 1);
  assert.deepEqual(row?.cleanupBlocked, [{ repo: "web", count: 2 }]);
  assert.equal(row?.title, "Fix the sync");
});

test("elapsed uses now for a running row and updatedAt for a lost or finished row; worktree is absent without folder and branch", () => {
  const [live, lost] = flattenSessions(
    [
      card("LOCAL-1", {
        sessionSummaries: [
          summary("live"),
          summary("lost", { lost: true, active: false }),
        ],
      }),
    ],
    NOW,
  );
  assert.equal(live?.elapsedMs, 2 * 60 * 60_000);
  assert.equal(live?.running, true);
  assert.equal(lost?.elapsedMs, 90 * 60_000);
  assert.equal(lost?.running, false);
  assert.equal(live?.worktree, undefined);
  const [finished, sibling] = flattenSessions(
    [
      card("LOCAL-2", {
        column: "done",
        sessionSummaries: [summary("done"), summary("sib", { active: false })],
      }),
    ],
    NOW,
  );
  assert.equal(finished?.running, false);
  assert.equal(finished?.elapsedMs, 90 * 60_000);
  assert.equal(sibling?.running, true);
});

const row = (extra: Partial<SessionRow>): SessionRow => ({
  key: "c:s",
  cardId: "c",
  identifier: "LOCAL-1",
  title: "t",
  sessionId: "s",
  shortId: "s",
  startedAt: "2026-09-24T10:00:00.000Z",
  lastActiveAt: "2026-09-24T11:00:00.000Z",
  elapsedMs: 0,
  prs: [],
  previews: [],
  lost: false,
  active: true,
  running: true,
  cardLive: false,
  cleaningUp: false,
  column: "in_progress",
  cleanupBlocked: [],
  siblings: 1,
  ...extra,
});

test("sectioning follows the column for the active row, In progress for a live sibling, Lost whatever the column", () => {
  const byColumn = Object.fromEntries(
    (
      [
        "todo",
        "inbox",
        "in_progress",
        "in_review",
        "parked",
        "needs_input",
        "agent_done",
        "done",
      ] as const
    ).map((column) => [column, sessionSection(row({ column }))]),
  );
  assert.deepEqual(byColumn, {
    todo: "In progress",
    inbox: "In progress",
    in_progress: "In progress",
    in_review: "In progress",
    parked: "In progress",
    needs_input: "Needs you",
    agent_done: "Finished",
    done: "Finished",
  });
  assert.equal(
    sessionSection(row({ column: "needs_input", active: false })),
    "In progress",
  );
  assert.equal(sessionSection(row({ column: "done", lost: true })), "Lost");
  assert.equal(
    sessionSection(row({ column: "needs_input", lost: true, active: false })),
    "Lost",
  );
});

test("the status chip label reads Lost, Working for a sibling, else the column's word", () => {
  assert.equal(sessionStatusLabel(row({ lost: true })), "Lost");
  assert.equal(
    sessionStatusLabel(row({ active: false, column: "needs_input" })),
    "Working",
  );
  assert.deepEqual(
    (
      [
        "todo",
        "inbox",
        "in_progress",
        "needs_input",
        "in_review",
        "parked",
        "agent_done",
        "done",
      ] as const
    ).map((column) => sessionStatusLabel(row({ column }))),
    [
      "To Do",
      "To Do",
      "Working",
      "Needs you",
      "Review",
      "Parked",
      "Done",
      "Done",
    ],
  );
});

test("formatElapsed reads hours and minutes, minutes and seconds, or seconds, never negative", () => {
  assert.equal(formatElapsed(2 * 3_600_000 + 5 * 60_000 + 9_000), "2h 05m 09s");
  assert.equal(formatElapsed(45 * 60_000 + 7_000), "45m 07s");
  assert.equal(formatElapsed(12_000), "12s");
  assert.equal(formatElapsed(3_599_000), "59m 59s");
  assert.equal(formatElapsed(3_600_000), "1h 00m 00s");
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(-5_000), "0s");
});

test("a session still starting is not lost, a card cleaning up is flagged, and a bad time renders nothing", () => {
  const [starting] = flattenSessions(
    [
      card("LOCAL-9", {
        provisioningStep: "creating worktree",
        cleaningUp: true,
        activeSessionId: "s9",
        sessionSummaries: [summary("s9", { lost: true, ordinal: 1 })],
      }),
    ],
    NOW,
  );
  assert.equal(starting?.lost, false);
  assert.equal(starting?.running, true);
  assert.equal(starting?.cleaningUp, true);
  assert.equal(starting?.restoreSessionId, "s9");
  assert.equal(formatElapsed(Number.NaN), "");
});

test("only the newest session reads as starting, and cardLive follows the active session or a card still provisioning", () => {
  const [older, newest] = flattenSessions(
    [
      card("LOCAL-8", {
        provisioningStep: "creating worktree",
        sessionSummaries: [
          summary("old", { lost: true, active: false, ordinal: 1 }),
          summary("new", { lost: true, active: true, ordinal: 2 }),
        ],
      }),
    ],
    NOW,
  );
  assert.equal(older?.lost, true);
  assert.equal(newest?.lost, false);
  assert.equal(older?.cardLive, true);
  const [liveActive, lostSibling] = flattenSessions(
    [
      card("LOCAL-7", {
        sessionSummaries: [
          summary("a", { active: true, ordinal: 1 }),
          summary("b", { lost: true, active: false, ordinal: 2 }),
        ],
      }),
    ],
    NOW,
  );
  assert.equal(liveActive?.cardLive, true);
  assert.equal(lostSibling?.cardLive, true);
});
