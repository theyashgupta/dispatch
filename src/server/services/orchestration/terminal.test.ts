import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { ensureTerminal } = await import("./terminal.js");

void test("a vanished tmux pane marks the session lost, in Done too, instead of a dead Reconnect loop", async () => {
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
