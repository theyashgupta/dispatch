import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { PaneSample } from "./watcher.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const tmux = await import("../tmux.js");
const { run } = await import("../exec.js");
const { resolveBinaryPath } = await import("../resolve-binary.js");
const { setPaneSink, startMarkerWatcher } = await import("./watcher.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

after(async () => {
  setPaneSink(null);
  await run("tmux", [...tmux.TMUX_SERVER_ARGS, "kill-server"]).catch(
    () => undefined,
  );
  env.cleanup();
});

const PANE_TEXT = "pane-sink-probe-line";

async function until(check: () => boolean, ms = 8_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

await store.load();
let cardId = "";
let sessionId = "";
let tmuxName = "";
if (hasTmux) {
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "sink", "");
  tmuxName = `dsp-${card.id}`;
  await tmux.newSession(tmuxName, env.root, [
    "sh",
    "-c",
    `echo ${PANE_TEXT}; sleep 60`,
  ]);
  await store.completeStart(card.id, undefined, {
    workspacePath: env.root,
    tmuxSession: tmuxName,
    branch: card.id,
  });
  await store.mintHookChannel(card.id, "pane-sink-token-0123456789abcdef");
  await store.markHookRouted(card.id, undefined, new Date().toISOString());
  const live = store.getCard(card.id)!;
  cardId = live.id;
  sessionId = live.activeSessionId!;
}

void test(
  "the sink receives the captured pane of a hook-routed session, so it runs before the channel gate",
  { skip: !hasTmux },
  async () => {
    const samples: PaneSample[] = [];
    setPaneSink((sample) => {
      samples.push(sample);
    });
    startMarkerWatcher("auto");
    assert.ok(await until(() => samples.some((s) => s.cardId === cardId)));
    const sample = samples.find((s) => s.cardId === cardId)!;
    assert.equal(sample.sessionId, sessionId);
    assert.equal(sample.tmuxSession, tmuxName);
    assert.ok(sample.pane.includes(PANE_TEXT));
  },
);

void test(
  "a throwing or rejecting sink does not stop the tick",
  { skip: !hasTmux },
  async () => {
    let syncCalls = 0;
    setPaneSink(() => {
      syncCalls++;
      throw new Error("sync sink failure");
    });
    assert.ok(await until(() => syncCalls >= 2));
    let asyncCalls = 0;
    setPaneSink(() => {
      asyncCalls++;
      return Promise.reject(new Error("async sink failure"));
    });
    assert.ok(await until(() => asyncCalls >= 2));
    let healthyCalls = 0;
    setPaneSink(() => {
      healthyCalls++;
    });
    assert.ok(await until(() => healthyCalls >= 1));
  },
);
