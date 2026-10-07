import test, { after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const tmux = await import("../tmux.js");
const { run } = await import("../exec.js");
const { resolveBinaryPath } = await import("../resolve-binary.js");
const { startMarkerWatcher } = await import("./watcher.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "status-line",
  "full.txt",
);

after(async () => {
  await run("tmux", [...tmux.TMUX_SERVER_ARGS, "kill-server"]).catch(
    () => undefined,
  );
  env.cleanup();
});

async function startedCard(title: string): Promise<string> {
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  const name = `dsp-${card.id}`;
  await tmux.newSession(name, env.root, [
    "sh",
    "-c",
    `cat '${FIXTURE}'; sleep 30`,
  ]);
  await store.completeStart(card.id, undefined, {
    workspacePath: env.root,
    tmuxSession: name,
    branch: card.id,
  });
  assert.equal(store.getCard(card.id)?.column, "in_progress");
  return card.id;
}

function activeSession(cardId: string) {
  const card = store.getCard(cardId);
  return card?.sessions?.find((s) => s.id === card.activeSessionId);
}

async function metersOf(cardId: string) {
  const deadline = Date.now() + 6_000;
  while (activeSession(cardId)?.contextPercent === undefined) {
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return activeSession(cardId);
}

await store.load();
const paneCardId = hasTmux ? await startedCard("meters-pane") : "";
const hookCardId = hasTmux ? await startedCard("meters-hook") : "";
if (hasTmux) {
  await store.mintHookChannel(hookCardId, "meters-hook-token-0123456789");
  await store.markHookRouted(hookCardId, undefined, new Date().toISOString());
  startMarkerWatcher("auto");
}

void test(
  "a watcher tick writes the status line meters of a pane-routed session",
  { skip: !hasTmux },
  async () => {
    assert.equal(activeSession(paneCardId)?.hookRoutedAt, undefined);
    const session = await metersOf(paneCardId);
    assert.equal(session?.contextPercent, 38);
    assert.equal(session?.cost, 1.25);
  },
);

void test(
  "a watcher tick still writes the meters of a hook-routed session",
  { skip: !hasTmux },
  async () => {
    assert.ok(activeSession(hookCardId)?.hookRoutedAt);
    const session = await metersOf(hookCardId);
    assert.equal(session?.contextPercent, 38);
    assert.equal(session?.cost, 1.25);
  },
);
