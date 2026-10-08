import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { inboxWaitingCount } from "../../shared/inbox-count.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, Card } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("./board.store.js");
after(() => env.cleanup());

const SBX = parseBoardKey("SBX") as BoardKey;
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const ticket = await store.createLocalCard(SBX, "Plain ticket", "");
const hidden = await store.createOrchestratorCard(
  SBX,
  "Orchestrator: lead",
  "lead",
);
await store.completeStart(hidden.id, undefined, {
  workspacePath: "/sbx/sessions/hidden",
  branch: hidden.id,
  tmuxSession: `dsp-${hidden.id}`,
});
await store.completeStart(ticket.id, undefined, {
  workspacePath: "/sbx/sessions/ticket",
  branch: ticket.id,
  tmuxSession: `dsp-${ticket.id}`,
});

const ids = (cards: Pick<Card, "id">[]) => cards.map((c) => c.id);

void test("the orchestrator card is a hidden card with its owner on the board", () => {
  const card = store.getCard(hidden.id);
  assert.equal(card?.source, "orchestrator");
  assert.equal(card?.ownerOrchestrator, "lead");
  assert.equal(card?.boardKey, SBX);
  assert.equal(card?.tmuxSession, `dsp-${hidden.id}`);
});

void test("the snapshot leaves the hidden card out", () => {
  const snap = store.snapshot(SBX);
  assert.ok(ids(snap.cards).includes(ticket.id));
  assert.equal(ids(snap.cards).includes(hidden.id), false);
});

void test("search leaves the hidden card out by title and by identifier", () => {
  for (const q of ["Orchestrator", hidden.identifier.toLowerCase()]) {
    const found = store.searchCards(SBX, q, 20);
    assert.equal(found.total, 0, q);
  }
  assert.equal(store.searchCards(SBX, "Plain", 20).total, 1);
});

void test("the card list leaves the hidden card out, and the full list keeps it", () => {
  assert.equal(ids(store.listCards(SBX)).includes(hidden.id), false);
  assert.ok(ids(store.listCards(SBX)).includes(ticket.id));
  assert.ok(ids(store.listAllCards(SBX)).includes(hidden.id));
});

void test("the inbox count and the column counts of the snapshot ignore the hidden card", async () => {
  await store.applyMarker(
    hidden.id,
    undefined,
    "needs_input",
    "question",
    "marker-1",
    "status_needs_input",
  );
  assert.equal(store.getCard(hidden.id)?.column, "needs_input");
  const snap = store.snapshot(SBX);
  assert.equal(inboxWaitingCount(snap.cards, []), 0);
  assert.equal(snap.cards.filter((c) => c.column === "needs_input").length, 0);
});

void test("the supervisor and the watcher still see the hidden card session", () => {
  const live = store.sessionsWithTmux(SBX).map((entry) => entry.card.id);
  assert.ok(live.includes(hidden.id));
  assert.ok(live.includes(ticket.id));
});
