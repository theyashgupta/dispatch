import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../../../shared/types.js";
import { sessionTime } from "./session-time.js";

const NOW = new Date("2026-10-07T12:00:00Z");

test("formats the age of the active session", () => {
  const card = {
    sessions: [
      { id: "old", createdAt: "2026-10-07T01:00:00Z", updatedAt: "" },
      { id: "s1", createdAt: "2026-10-07T09:50:00Z", updatedAt: "" },
    ],
    activeSessionId: "s1",
  } as Card;
  assert.equal(sessionTime(card, NOW), "Session 2 h 10 min");
});

test("is null without an active session", () => {
  assert.equal(sessionTime({} as Card, NOW), null);
});

test("formats the age of the active session from a wire-shape card", () => {
  const card = {
    activeSessionId: "s1",
    sessionSummaries: [
      {
        id: "s1",
        active: true,
        createdAt: "2026-10-07T09:50:00Z",
        updatedAt: "2026-10-07T11:00:00Z",
      },
    ],
  } as Card;
  assert.equal(sessionTime(card, NOW), "Session 2 h 10 min");
});
