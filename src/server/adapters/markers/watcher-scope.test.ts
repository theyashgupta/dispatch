import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const tmux = await import("../tmux.js");
const { run } = await import("../exec.js");
const { resolveBinaryPath } = await import("../resolve-binary.js");
const { startMarkerWatcher } = await import("./watcher.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

after(async () => {
  await run("tmux", [...tmux.TMUX_SERVER_ARGS, "kill-server"]).catch(
    () => undefined,
  );
  env.cleanup();
});

void test(
  "the marker watcher scans a live session on every board, not only the default one",
  { skip: !hasTmux },
  async () => {
    const acme = parseBoardKey("ACME");
    assert.ok(acme);
    await store.load();
    await store.createBoard({
      key: acme,
      name: "Acme",
      workspaceRoot: "/acme/sessions",
      repositories: [],
      linearTeamKeys: [],
    });
    const local = await store.createLocalCard(DEFAULT_BOARD_KEY, "local", "");
    const onAcme = await store.createLocalCard(acme, "acme", "");
    for (const card of [local, onAcme]) {
      const name = `dsp-${card.id}`;
      await tmux.newSession(name, env.root, [
        "sh",
        "-c",
        "echo 'DISPATCH_STATUS: DONE - finished'; sleep 60",
      ]);
      await store.completeStart(card.id, undefined, {
        workspacePath: env.root,
        tmuxSession: name,
        branch: card.id,
      });
      assert.equal(store.getCard(card.id)?.column, "in_progress");
    }

    startMarkerWatcher("pane");
    const deadline = Date.now() + 8_000;
    while (
      [local, onAcme].some(
        (card) => store.getCard(card.id)?.column !== "agent_done",
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(store.getCard(local.id)?.column, "agent_done");
    assert.equal(store.getCard(onAcme.id)?.column, "agent_done");
  },
);
