import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { ensureTerminal } = await import("./terminal.js");

afterEach(() => {
  setBoardRepository(store);
});

void test("a vanished tmux pane checks isCleaningUp, then calls markSessionLost for the card and session", async () => {
  const cardId = "card-dead-pane";
  const sessionId = "session-dead-pane";
  const tmuxSession = "dsp-test-no-such-session";
  const calls: unknown[][] = [];
  setBoardRepository(
    fakeBoardRepository({
      isCleaningUp: (id) => {
        calls.push(["isCleaningUp", id]);
        return false;
      },
      markSessionLost: (id, sid) => {
        calls.push(["markSessionLost", id, sid]);
        return Promise.resolve();
      },
    }),
  );

  await ensureTerminal(cardId, sessionId, tmuxSession);

  assert.deepEqual(calls, [
    ["isCleaningUp", cardId],
    ["markSessionLost", cardId, sessionId],
  ]);
});

void test("a vanished tmux pane during cleanup does not mark the session lost", async () => {
  const cardId = "card-cleaning-up";
  const calls: unknown[][] = [];
  setBoardRepository(
    fakeBoardRepository({
      isCleaningUp: (id) => {
        calls.push(["isCleaningUp", id]);
        return true;
      },
    }),
  );

  await ensureTerminal(
    cardId,
    "session-cleaning-up",
    "dsp-test-no-such-session",
  );

  assert.deepEqual(calls, [["isCleaningUp", cardId]]);
});

void test("a vanished tmux pane marks the session lost in the real store, in Done too, instead of a dead Reconnect loop", async () => {
  await store.load();
  const created = await store.createLocalCard("dead pane", "");
  const tmuxSession = "dsp-test-no-such-session";
  await store.completeStart(created.id, undefined, {
    workspacePath: "/nowhere/dead-pane",
    tmuxSession,
    branch: "dead-pane",
  });
  await store.moveCardManual(created.id, "done");
  const before = store.getCard(created.id);
  assert.equal(before?.column, "done");
  assert.equal(before?.tmuxSession, tmuxSession);

  await ensureTerminal(created.id, before?.activeSessionId ?? "", tmuxSession);

  const after = store.getCard(created.id);
  assert.equal(after?.sessionLost, true);
  assert.equal(after?.tmuxSession, undefined);
  assert.equal(after?.terminalError, null);
  assert.equal(after?.column, "done");
});
