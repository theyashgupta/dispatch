import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
process.env.TMUX_TMPDIR = env.root;
delete process.env.TMUX;
const { run } = await import("../../adapters/exec.js");
const { TMUX_SERVER_ARGS } = await import("../../adapters/tmux.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { pauseCard, unpauseCard } = await import("./pause-card.js");
const { sendConfirmed } = await import("./supervisor-send.js");
const { probeResume, probeTools } = await import("./resume-probe.js");
const { MEMORY_RESUME_LINE } =
  await import("../../../shared/dispatch-lines.js");
const { paneAtPrompt, paneTerminal, paneTtyCooked } =
  await import("../../adapters/tmux.js");
const { actionTools, runActions } = await import("./supervisor-actions.js");
const { paneReady } = await import("../domain/supervisor-state.js");
const { setupSupervisedBoard, startSupervised, stopSupervisedTmux } =
  await import("../../test-support/supervised-session.js");
const available =
  (await resolveBinaryPath("tmux")) !== null &&
  (await resolveBinaryPath("python3")) !== null;

await setupSupervisedBoard();
const realProbeTools = { ...probeTools };
afterEach(() => {
  Object.assign(probeTools, realProbeTools);
});
after(async () => {
  await stopSupervisedTmux();
  env.cleanup();
});

void test(
  "a line sent after a memory pause and resume is submitted to the REPL",
  { skip: !available },
  async () => {
    const s = await startSupervised({
      tmpRoot: env.root,
      title: "LOCAL-139-pause",
      group: true,
      shell: true,
      scenario: { lfInserts: true },
    });
    const timing = {
      readyMs: 15_000,
      settleMs: 500,
      confirmMs: 5_000,
      pollMs: 200,
    };
    const transcriptOf = () => Promise.resolve(s.transcript);

    assert.equal(
      await sendConfirmed(
        s.card(),
        s.session(),
        "before the pause",
        "test",
        timing,
        transcriptOf,
      ),
      "confirmed",
    );

    await pauseCard(s.card().id, { by: "memory", reason: "test pause" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await unpauseCard(s.card().id, { reason: "test resume" });

    for (let i = 0; i < 50 && !paneReady(await s.pane()); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      paneReady(await s.pane()),
      "the REPL redrew its input row after resume",
    );
    assert.doesNotMatch(
      await s.pane(),
      /suspended \(tty/,
      "the shim was not stopped by SIGTTOU",
    );

    assert.equal(
      await sendConfirmed(
        s.card(),
        s.session(),
        "after the resume",
        "test",
        timing,
        transcriptOf,
      ),
      "confirmed",
    );
    assert.ok(s.userTexts().includes("after the resume"));

    assert.equal(
      await paneTtyCooked(`=${s.name}:`),
      false,
      "pane tty is raw (-icanon) after resume",
    );
  },
);

void test(
  "a SIGCONT that reaches the shim while its job is in the background does not stop it",
  { skip: !available },
  async () => {
    const s = await startSupervised({
      tmpRoot: env.root,
      title: "LOCAL-139-bg-cont",
      group: true,
      shell: true,
      scenario: { lfInserts: true },
    });
    const target = `=${s.name}:`;
    const timing = {
      readyMs: 15_000,
      settleMs: 500,
      confirmMs: 5_000,
      pollMs: 200,
    };

    await pauseCard(s.card().id, { by: "memory", reason: "test pause" });
    const pids = s.card().paused?.pids ?? [];
    assert.ok(pids.length >= 2, "the pause recorded the shell and its job");
    const [shellPid, shimPid] = pids;

    process.kill(shellPid, "SIGCONT");
    for (let i = 0; i < 50; i++) {
      const t = await paneTerminal(target);
      if (t && t.tpgid === t.pgid) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const owner = await paneTerminal(target);
    assert.equal(owner?.tpgid, owner?.pgid, "the shell took the terminal");

    process.kill(shimPid, "SIGCONT");
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    assert.doesNotMatch(
      await s.pane(),
      /suspended \(tty output\)/,
      "the shim was not stopped by SIGTTOU in the background",
    );
    const { stdout } = await run("ps", ["-o", "stat=", "-p", String(shimPid)]);
    assert.doesNotMatch(stdout.trim(), /^T/, "the shim is not stopped");

    await unpauseCard(s.card().id, { reason: "test resume" });
    for (let i = 0; i < 50 && !paneReady(await s.pane()); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(
      await sendConfirmed(
        s.card(),
        s.session(),
        "after the background continue",
        "test",
        timing,
        () => Promise.resolve(s.transcript),
      ),
      "confirmed",
    );
    assert.equal(
      await paneTtyCooked(target),
      false,
      "pane tty is raw (-icanon) after resume",
    );
  },
);

const PROBE_TIMING = {
  readyMs: 10_000,
  settleMs: 500,
  confirmMs: 5_000,
  pollMs: 200,
};

void test(
  "the resume probe confirms its line after a memory resume",
  { skip: !available },
  async () => {
    const s = await startSupervised({
      tmpRoot: env.root,
      title: "LOCAL-139-probe-ok",
      group: true,
      shell: true,
      scenario: { lfInserts: true },
    });
    await pauseCard(s.card().id, { by: "memory", reason: "test pause" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await unpauseCard(s.card().id, { reason: "test resume" });
    probeTools.timing = PROBE_TIMING;
    assert.equal(s.card().column, "in_progress");

    await probeResume(s.card().id);

    assert.ok(s.userTexts().includes(MEMORY_RESUME_LINE));
    const rows = s.actions().map((e) => e.data);
    assert.ok(
      rows.some((d) => d.action === "resume_probe" && d.result === "confirmed"),
    );
    assert.ok(!rows.some((d) => d.action === "relaunch"));
  },
);

void test(
  "a REPL that stays cooked after resume is ended and handed to the resume action",
  { skip: !available },
  async () => {
    const s = await startSupervised({
      tmpRoot: env.root,
      title: "LOCAL-139-probe-cooked",
      group: true,
      shell: true,
      scenario: { lfInserts: true },
    });
    await pauseCard(s.card().id, { by: "memory", reason: "test pause" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await unpauseCard(s.card().id, { reason: "test resume" });
    const target = `=${s.name}:`;
    for (let i = 0; i < 30 && (await paneTtyCooked(target)) !== false; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(
      await paneTtyCooked(target),
      false,
      "the shim set raw mode again after resume",
    );
    const { stdout } = await run("tmux", [
      ...TMUX_SERVER_ARGS,
      "display-message",
      "-p",
      "-t",
      target,
      "#{pane_tty}",
    ]);
    await run("stty", [
      process.platform === "darwin" ? "-f" : "-F",
      stdout.trim(),
      "sane",
    ]);
    assert.equal(await paneTtyCooked(target), true, "stty sane made it cooked");
    probeTools.resume = (card, session, evidence) =>
      runActions(card, session, [{ kind: "resume" }], evidence, {
        ...actionTools,
        resume: () => Promise.resolve(),
        relaunch: async () => {
          await s.launch();
          return "launched";
        },
        atShellPrompt: (t) => paneAtPrompt(t).catch(() => false),
        claudeUpMs: 10_000,
      });
    probeTools.timing = PROBE_TIMING;
    assert.equal(s.card().column, "in_progress");

    await probeResume(s.card().id);

    const relaunch = s.actions().find((e) => e.data.action === "relaunch");
    assert.equal(relaunch?.data.level, "WARN");
    const restartedBy = Date.now() + 20_000;
    const restarted = () =>
      s.userTexts().some((t) => t.startsWith("The session was restarted."));
    while (!restarted() && Date.now() < restartedBy) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(restarted(), "the supervisor continue line reached the REPL");
    assert.ok(!s.actions().some((e) => e.data.reason === "resume_failed"));
  },
);
