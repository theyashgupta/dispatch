import assert from "node:assert/strict";
import { test } from "node:test";
import { activeSessionView } from "./active-session.js";
import type { Card, Session, SessionSummary } from "./types.js";

const USAGE = { fiveHourPercent: 20, sevenDayPercent: 40 };

test("a server-shape card reads its active sessions entry", () => {
  const card = {
    activeSessionId: "s2",
    sessions: [
      { id: "s1", createdAt: "c1", updatedAt: "u1", state: "idle" },
      {
        id: "s2",
        createdAt: "c2",
        updatedAt: "u2",
        state: "stale",
        stateSince: "t",
        usage: USAGE,
        metersAt: "m2",
        claudeAccountId: "a1",
      },
    ] as Session[],
  } as Card;
  assert.deepEqual(activeSessionView(card), {
    id: "s2",
    state: "stale",
    stateReason: undefined,
    stateSince: "t",
    createdAt: "c2",
    updatedAt: "u2",
    claudeAccountId: "a1",
    contextPercent: undefined,
    model: undefined,
    cost: undefined,
    usage: USAGE,
    metersAt: "m2",
  });
});

test("a wire-shape card reads the flat mirror and the active summary", () => {
  const card = {
    activeSessionId: "s2",
    state: "needs_input",
    stateReason: "usage_stop",
    stateSince: "t",
    contextPercent: 41,
    usage: USAGE,
    sessionSummaries: [
      { id: "s1", active: false, createdAt: "c1", updatedAt: "u1" },
      {
        id: "s2",
        active: true,
        createdAt: "c2",
        updatedAt: "u2",
        claudeAccountId: "a1",
      },
    ] as SessionSummary[],
  } as Card;
  const view = activeSessionView(card);
  assert.equal(view?.id, "s2");
  assert.equal(view?.state, "needs_input");
  assert.equal(view?.stateReason, "usage_stop");
  assert.equal(view?.contextPercent, 41);
  assert.equal(view?.createdAt, "c2");
  assert.equal(view?.claudeAccountId, "a1");
  assert.equal(view?.metersAt, "u2");
});

test("the id comes from the active summary when the card names none", () => {
  const card = {
    sessionSummaries: [
      { id: "s9", active: true, createdAt: "c", updatedAt: "u" },
    ] as SessionSummary[],
  } as Card;
  assert.equal(activeSessionView(card)?.id, "s9");
});

test("a card with no session has no view", () => {
  assert.equal(activeSessionView({} as Card), null);
});

test("the flat mirror wins over a stale sessions entry", () => {
  const card = {
    activeSessionId: "s1",
    state: "working",
    sessions: [
      { id: "s1", createdAt: "c", updatedAt: "u", state: "stale" },
    ] as Session[],
  } as Card;
  assert.equal(activeSessionView(card)?.state, "working");
});
