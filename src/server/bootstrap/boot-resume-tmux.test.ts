import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateTmuxEnv } from "../test-support/fixtures.js";

const env = await isolateTmuxEnv();
const scenarioDir = path.join(env.root, "scenarios");
fs.mkdirSync(scenarioDir, { recursive: true });
process.env.FAKE_CLAUDE_SCENARIO_DIR = scenarioDir;
const { writeFakeClaudeTui } =
  await import("../test-support/fake-claude-tui.js");
writeFakeClaudeTui(env.binDir);
const { store } = await import("../store/board.store.js");
const { killTtyd } = await import("../adapters/ttyd.js");
const { reconcileSessions } = await import("./reconcile.js");
const { setHooksRuntime } = await import("../services/infra/config-holder.js");
const { resumeLostAtBoot } =
  await import("../services/orchestration/supervisor-boot.js");
const { continueText } =
  await import("../services/orchestration/supervisor-record.js");
const { typedLine } =
  await import("../services/orchestration/supervisor-send.js");
const { hasLiveSession } = await import("../../shared/running-group.js");
const { setupSupervisedBoard, startSupervised, stopSupervisedTmux } =
  await import("../test-support/supervised-session.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
await setupSupervisedBoard();

after(async () => {
  await stopSupervisedTmux();
  env.cleanup();
});

void test(
  "the boot sweep resumes two lost In progress cards with real tmux and leaves an Agent done card lost",
  { skip: !env.canRunRealTmux, timeout: 240_000 },
  async () => {
    const running = [
      await startSupervised({
        tmpRoot: env.root,
        title: "boot-a",
        shell: true,
      }),
      await startSupervised({
        tmpRoot: env.root,
        title: "boot-b",
        shell: true,
      }),
    ];
    const done = await startSupervised({
      tmpRoot: env.root,
      title: "boot-c",
      shell: true,
    });
    await store.applyMarker(
      done.card().id,
      done.session().id,
      "agent_done",
      undefined,
      "boot-done",
      "status_agent_done",
    );
    assert.equal(done.card().column, "agent_done");
    const expected = running.map((s) =>
      typedLine(continueText(s.card(), s.session(), "resume")),
    );
    for (const s of running) {
      fs.writeFileSync(
        path.join(scenarioDir, `${s.card().id}.json`),
        JSON.stringify({
          transcriptPath: s.transcript,
          statusRows: ["  ? for shortcuts"],
        }),
      );
    }

    try {
      await env.killServer();
      await reconcileSessions();
      for (const s of [...running, done]) {
        assert.equal(s.card().sessionLost, true, `${s.name} is marked lost`);
      }
      const lines: string[] = [];
      await resumeLostAtBoot({
        sample: () => Promise.resolve(),
        log: (line) => lines.push(line),
      });

      assert.deepEqual(
        lines,
        running.map(
          (s) => `[supervisor] boot resume ${s.card().identifier}: resumed`,
        ),
      );
      running.forEach((s, i) => {
        assert.ok(hasLiveSession(s.card()), `${s.name} has a live session`);
        assert.ok(
          s.userTexts().includes(expected[i]),
          `${s.name} received the continue text`,
        );
      });
      assert.equal(done.card().sessionLost, true);
      assert.deepEqual(done.userTexts(), []);
    } finally {
      for (const s of [...running, done]) killTtyd(s.name);
    }
  },
);
