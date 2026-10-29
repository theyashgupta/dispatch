import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { archiveBoard, boardCounts, listBoardCards, listBoardSessions } =
  await import("./boards.js");
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
for (const card of [ticket, hidden]) {
  await store.completeStart(card.id, undefined, {
    workspacePath: `/sbx/sessions/${card.id}`,
    branch: card.id,
    tmuxSession: `dsp-${card.id}`,
  });
}
await store.applyMarker(
  hidden.id,
  undefined,
  "needs_input",
  "question",
  "marker-1",
  "status_needs_input",
);

const TOKEN = "session-token-must-not-leak";
const ACME = parseBoardKey("ACME") as BoardKey;
await store.createBoard({
  key: ACME,
  name: "Acme",
  workspaceRoot: "/acme/sessions",
  repositories: [],
  linearTeamKeys: [],
});
const acmeLive = await store.createLocalCard(ACME, "Live ticket", "");
const acmeLost = await store.createLocalCard(ACME, "Lost ticket", "");
for (const card of [acmeLive, acmeLost]) {
  await store.completeStart(card.id, undefined, {
    workspacePath: `/acme/sessions/${card.id}`,
    branch: card.id,
    tmuxSession: `dsp-${card.id}`,
  });
}
await store.mintHookChannel(acmeLive.id, TOKEN);
assert.equal(
  store.getCard(acmeLive.id)?.sessions?.some((s) => s.hookToken === TOKEN),
  true,
);
await store.markSessionLost(acmeLost.id, undefined);

void test("the card list service leaves the hidden card out", () => {
  const listed = listBoardCards(SBX, {});
  assert.deepEqual(
    listed.cards.map((c) => c.id),
    [ticket.id],
  );
  assert.equal(listBoardCards(SBX, { text: "Orchestrator" }).total, 0);
  assert.equal(listBoardCards(SBX, { source: "orchestrator" }).total, 0);
});

void test("the session list leaves the hidden card out", () => {
  const sessions = listBoardSessions(SBX, undefined);
  assert.ok(sessions.some((s) => s.cardId === ticket.id));
  assert.equal(
    sessions.some((s) => s.cardId === hidden.id),
    false,
  );
});

void test("the board counts ignore the hidden card, even live and needing input", () => {
  const count = boardCounts().counts.find((c) => c.key === SBX);
  assert.equal(count?.running, 1);
  assert.equal(count?.attention, 0);
});

void test("a stopped orchestrator's live hidden card does not block archive, a running one does", async () => {
  const OTH = parseBoardKey("OTH") as BoardKey;
  await store.createBoard({
    key: OTH,
    name: "Other",
    workspaceRoot: "/oth/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
  const card = await store.createOrchestratorCard(
    OTH,
    "Orchestrator: main",
    "main",
  );
  await store.completeStart(card.id, undefined, {
    workspacePath: `/oth/sessions/${card.id}`,
    branch: card.id,
    tmuxSession: `dsp-${card.id}`,
  });
  const main = {
    id: "main",
    name: "Main",
    role: "main" as const,
    scope: { groupIds: [], ticketIds: [] },
    policyOverride: {},
    cardId: card.id,
    createdAt: new Date().toISOString(),
  };
  await store.setBoardOrchestrators(OTH, [{ ...main, state: "running" }]);
  await assert.rejects(archiveBoard(OTH), {
    details: { code: "sessions-running", running: 1 },
  });
  await store.setBoardOrchestrators(OTH, [{ ...main, state: "stopped" }]);
  assert.equal((await archiveBoard(OTH)).archived, true);
});

void test("the session list keeps the live sessions for live=true and the lost ones for live=false", () => {
  assert.deepEqual(
    listBoardSessions(ACME, undefined)
      .map((s) => s.cardId)
      .sort(),
    [acmeLive.id, acmeLost.id].sort(),
  );
  assert.deepEqual(
    listBoardSessions(ACME, true).map((s) => s.cardId),
    [acmeLive.id],
  );
  assert.deepEqual(
    listBoardSessions(ACME, false).map((s) => s.cardId),
    [acmeLost.id],
  );
  assert.deepEqual(listBoardSessions(SBX, false), []);
});

void test("a session list entry carries no hook token", () => {
  const json = JSON.stringify(listBoardSessions(ACME, undefined));
  assert.ok(!json.includes(TOKEN));
  assert.ok(!json.includes("hookToken"));
});

void test("an archived board still lists its sessions", async () => {
  const ARC = parseBoardKey("ARC") as BoardKey;
  await store.createBoard({
    key: ARC,
    name: "Archive",
    workspaceRoot: "/arc/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
  const card = await store.createLocalCard(ARC, "Lost ticket", "");
  await store.completeStart(card.id, undefined, {
    workspacePath: `/arc/sessions/${card.id}`,
    branch: card.id,
    tmuxSession: `dsp-${card.id}`,
  });
  await store.markSessionLost(card.id, undefined);
  assert.equal((await archiveBoard(ARC)).archived, true);
  assert.deepEqual(
    listBoardSessions(ARC, undefined).map((s) => s.cardId),
    [card.id],
  );
});
