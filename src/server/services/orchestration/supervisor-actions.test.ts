import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ActionDeps } from "./supervisor-actions.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { capturePane } = await import("../../adapters/tmux.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { runActions, actionTools, resumeLostCard } =
  await import("./supervisor-actions.js");
const { loopFilePath } = await import("../domain/loop-progress.js");
const { initialPlanMemory, planActions } =
  await import("../domain/supervisor-plan.js");
const {
  SBX,
  LOOP_PROGRESS,
  setupSupervisedBoard,
  startSupervised,
  stopSupervisedTmux,
} = await import("../../test-support/supervised-session.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;
const { recordMemory } = await import("../../test-support/memory-fixtures.js");

await setupSupervisedBoard();
after(async () => {
  await stopSupervisedTmux();
  env.cleanup();
});

const loopCard = (
  title: string,
  scenario: Record<string, unknown>,
  group = false,
  fixture?: string,
) =>
  startSupervised({
    tmpRoot: env.root,
    title,
    scenario,
    group,
    ...(fixture === undefined ? {} : { fixture }),
  });

function deps(overrides: Partial<ActionDeps> = {}): ActionDeps {
  return {
    ...actionTools,
    resume: () => Promise.resolve(),
    relaunch: () => Promise.resolve("launched"),
    atShellPrompt: () => Promise.resolve(false),
    shellRoot: () => Promise.resolve(true),
    paneTerminal: () => Promise.resolve(null),
    kill: () => undefined,
    grace: { hangupMs: 50, killMs: 50, pollMs: 10 },
    claudeUpMs: 1_000,
    ...overrides,
  };
}

const MENU = (rows: string[]) => ({
  prompt: "",
  dialog: { title: "Do you want to proceed?", rows, cursor: 0 },
});

void test(
  "a self-stopped loop gets one continue prompt and a second stop gives needs_input",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("restart", {});
    const input = {
      from: "working" as const,
      to: "idle" as const,
      loop: { engineActive: true, handoffPending: false, unitPhase: "1/3" },
      usageLimit: "wait" as const,
      wokeAt: null,
      now: Date.now(),
    };
    const first = planActions({ ...input, memory: initialPlanMemory() });
    await runActions(loop.card(), loop.session(), first.actions, "idle");
    const sent = loop.userTexts();
    assert.equal(sent.length, 1);
    assert.ok(
      sent[0].includes(
        path.join(loop.root, loopFilePath(LOOP_PROGRESS.slug, "progress.md")),
      ),
    );
    assert.ok(sent[0].includes("resume.md"));
    const second = planActions({ ...input, memory: first.memory });
    await runActions(loop.card(), loop.session(), second.actions, "idle");
    assert.equal(loop.userTexts().length, 1);
    assert.equal(loop.session().state, "needs_input");
    assert.equal(loop.session().stateReason, "supervisor_gave_up");
    assert.equal(loop.card().column, "needs_input");
    assert.deepEqual(
      loop.actions().map((e) => [e.data.action, e.data.result ?? null]),
      [
        ["continue", "confirmed"],
        ["needs_input", null],
      ],
    );
  },
);

void test(
  "an API error gets one continue prompt",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("api-error", {});
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "continue", duty: "api_error" }],
      "pane: API Error: 500",
    );
    assert.equal(loop.userTexts().length, 1);
    assert.ok(
      loop.userTexts()[0].startsWith("The last turn ended on an API error."),
    );
    assert.equal(loop.actions().length, 1);
    assert.equal(loop.actions()[0].data.duty, "api_error");
  },
);

void test(
  "a dangerous delete prompt gets the No row and the event keeps the command",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("delete", MENU(["1. Yes", "2. No"]));
    const evidence =
      "pane: Dangerous rm operation on possibly-empty variable path: rm -f $SB/*.out";
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "answer_prompt", promptKind: "dangerous_delete" }],
      evidence,
    );
    assert.deepEqual(
      (await loop.keysSettled(2)).map((k) => [k.key, k.row]),
      [
        ["down", "2. No"],
        ["enter", "2. No"],
      ],
    );
    assert.equal(loop.actions()[0].data.result, "declined");
    assert.equal(loop.actions()[0].data.evidence, evidence);
  },
);

void test(
  "a held peer message gets the Deny row",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard(
      "peer",
      MENU([
        "Deny, drop it and tell the sender it was declined",
        "Deliver this message to Claude",
      ]),
    );
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "answer_prompt", promptKind: "peer_message" }],
      "pane: Deliver this message to Claude",
    );
    assert.deepEqual(
      (await loop.keysSettled(1)).map((k) => k.key),
      ["enter"],
    );
    assert.match(String(loop.keys()[0].row), /^Deny\b/);
  },
);

void test(
  "a generic permission prompt plans no action and gets no key",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("generic", MENU(["1. Yes", "2. No"]));
    const plan = planActions({
      from: "working",
      to: "permission_prompt",
      promptKind: "other",
      loop: { engineActive: true, handoffPending: false, unitPhase: "1/3" },
      usageLimit: "wait",
      wokeAt: null,
      now: Date.now(),
      memory: initialPlanMemory(),
    });
    await runActions(
      loop.card(),
      loop.session(),
      plan.actions,
      "pane: Do you want to proceed?",
    );
    assert.deepEqual(await loop.keysSettled(1), []);
    assert.deepEqual(loop.actions(), []);
  },
);

void test(
  "a roadmap_complete loop gets its engine file renamed to .done",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("close", {});
    const engine = path.join(loop.root, ".claude", "ralph-loop.local.md");
    fs.mkdirSync(path.dirname(engine), { recursive: true });
    fs.writeFileSync(engine, "---\nactive: true\n---\n");
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "close_loop" }],
      "pane: <promise>ROADMAP COMPLETE",
    );
    assert.equal(fs.existsSync(engine), false);
    assert.equal(fs.existsSync(`${engine}.done`), true);
    assert.equal(loop.actions()[0].data.result, "closed");
    assert.equal(loop.card().column, "in_progress");
  },
);

const DONE_ENGINE = {
  active: true,
  iteration: 1,
  sessionId: "sess-now",
  handoffPending: false,
  startedAt: null,
  closed: false,
};

const doneText = (slug: string, session: string) =>
  `---\nactive: false\nsession_id: ${session}\ncompletion_promise: "RALPH COMPLETE ${slug}"\nclosed_reason: close_loop\n---\nbody\n`;

void test(
  "a close with a missing engine file rewrites a .done of another loop",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("close-old-done", {});
    await store.setLoopProgress(loop.card().id, {
      ...LOOP_PROGRESS,
      engine: DONE_ENGINE,
    });
    const engine = path.join(loop.root, ".claude", "ralph-loop.local.md");
    fs.mkdirSync(path.dirname(engine), { recursive: true });
    fs.writeFileSync(`${engine}.done`, doneText("old-loop", "old-session"));
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "close_loop" }],
      "pane: <promise>ROADMAP COMPLETE",
    );
    const written = fs.readFileSync(`${engine}.done`, "utf8");
    assert.match(written, /^completion_promise: "RALPH COMPLETE sbx-loop"$/m);
    assert.match(written, /^session_id: sess-now$/m);
    assert.match(written, /^closed_reason: done_marker$/m);
    assert.equal(loop.actions()[0].data.result, "closed");
  },
);

void test(
  "a close with a missing engine file keeps a .done of the same loop unchanged",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("close-same-done", {});
    await store.setLoopProgress(loop.card().id, {
      ...LOOP_PROGRESS,
      engine: DONE_ENGINE,
    });
    const engine = path.join(loop.root, ".claude", "ralph-loop.local.md");
    fs.mkdirSync(path.dirname(engine), { recursive: true });
    const same = doneText("sbx-loop", "sess-now");
    fs.writeFileSync(`${engine}.done`, same);
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "close_loop" }],
      "pane: <promise>ROADMAP COMPLETE",
    );
    assert.equal(fs.readFileSync(`${engine}.done`, "utf8"), same);
    assert.equal(loop.actions()[0].data.result, "closed");
  },
);

void test(
  "a lost session runs the resume saga and then gets the resume prompt",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-ok", {});
    const resumed: string[] = [];
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "resume" }],
      "tmux: session not found",
      deps({
        ...deps(),
        resume: (cardId) => {
          resumed.push(cardId);
          return Promise.resolve();
        },
      }),
    );
    assert.deepEqual(resumed, [loop.card().id]);
    assert.equal(loop.userTexts().length, 1);
    assert.ok(loop.userTexts()[0].startsWith("The session was restarted."));
    assert.equal(loop.actions().at(-1)?.data.result, "confirmed");
  },
);

void test(
  "resume_session on a supervisor-on board relaunches and types the standard resume line",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-card-on", {});
    const resumed: string[] = [];
    await resumeLostCard(
      loop.card(),
      deps({
        resume: (id) => {
          resumed.push(id);
          return Promise.resolve();
        },
      }),
    );
    assert.deepEqual(resumed, [loop.card().id]);
    assert.equal(loop.userTexts().length, 1);
    assert.ok(loop.userTexts()[0].startsWith("The session was restarted."));
    const last = loop.actions().at(-1);
    assert.equal(last?.data.action, "resume");
    assert.equal(last?.data.result, "confirmed");
  },
);

void test(
  "a loop lost while its handoff is pending gets the handoff resume prompt",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-handoff-pending", {});
    await store.setLoopProgress(loop.card().id, {
      ...LOOP_PROGRESS,
      engine: {
        active: true,
        iteration: 4,
        sessionId: "handoff-pending",
        handoffPending: true,
        startedAt: null,
        closed: false,
      },
    });
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "resume" }],
      "tmux: session not found",
      deps(),
    );
    assert.equal(loop.userTexts().length, 1);
    const typed = loop.userTexts()[0];
    const pointer = /^Read (.+) and follow it\.$/.exec(typed);
    const text = pointer ? fs.readFileSync(pointer[1], "utf8") : typed;
    assert.ok(text.startsWith(`Resume the ${LOOP_PROGRESS.slug} loop.`));
    assert.ok(text.includes("ralph-loop.local.md"));
    const last = loop.actions().at(-1);
    assert.equal(last?.data.action, "resume");
    assert.equal(last?.data.result, "confirmed");
  },
);

void test(
  "resume_session on a supervisor-off board relaunches and types nothing",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-card-off", {});
    const policy = store.getBoard(SBX)!.policy;
    const resumed: string[] = [];
    await store.setBoardPolicy(SBX, { ...policy, supervisor: "off" });
    try {
      await resumeLostCard(
        loop.card(),
        deps({
          resume: (id) => {
            resumed.push(id);
            return Promise.resolve();
          },
        }),
      );
    } finally {
      await store.setBoardPolicy(SBX, { ...policy, supervisor: "on" });
    }
    assert.deepEqual(resumed, [loop.card().id]);
    assert.deepEqual(loop.userTexts(), []);
    assert.equal(
      loop.actions().some((e) => e.data.action === "resume"),
      false,
    );
  },
);

void test("the resume_session tool relaunches through resumeLostCard", async () => {
  const { sessionTools } = await import("./orchestrator-sessions.js");
  assert.equal(sessionTools.resume, resumeLostCard);
});

void test(
  "a failed resume sets needs_input with resume_failed",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-fail", {});
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "resume" }],
      "tmux: session not found",
      {
        ...deps(),
        resume: (cardId) => store.markSessionLost(cardId, loop.session().id),
      },
    );
    assert.equal(loop.session().state, "needs_input");
    assert.equal(loop.session().stateReason, "resume_failed");
    assert.equal(loop.userTexts().length, 0);
  },
);

void test(
  "under memory pressure a resume neither resumes nor relaunches and sets needs_input with the reason",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-memory", {});
    const calls: string[] = [];
    recordMemory(812, 1000);
    try {
      await runActions(
        loop.card(),
        loop.session(),
        [{ kind: "resume" }],
        "tmux: pane at shell prompt",
        deps({
          resume: (cardId) => {
            calls.push(`resume ${cardId}`);
            return Promise.resolve();
          },
          relaunch: (cardId) => {
            calls.push(`relaunch ${cardId}`);
            return Promise.resolve("launched");
          },
          atShellPrompt: () => Promise.resolve(true),
        }),
      );
    } finally {
      recordMemory(2048, 1000);
    }
    assert.deepEqual(calls, []);
    assert.equal(loop.session().state, "needs_input");
    assert.equal(loop.session().stateReason, "resume_failed");
    assert.equal(
      loop.actions().at(-1)?.data.evidence,
      "resume: free memory 812 MB is below the 1024 MB floor",
    );
  },
);

void test(
  "a session at the shell prompt is relaunched once, then gets the resume prompt",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-shell", {});
    let probes = 0;
    const relaunched: string[] = [];
    const resumed: string[] = [];
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "resume" }],
      "tmux: pane at shell prompt",
      deps({
        resume: (cardId) => {
          resumed.push(cardId);
          return Promise.resolve();
        },
        relaunch: (cardId) => {
          relaunched.push(cardId);
          return Promise.resolve("launched");
        },
        atShellPrompt: () => Promise.resolve(probes++ === 0),
      }),
    );
    assert.deepEqual(relaunched, [loop.card().id]);
    assert.deepEqual(resumed, []);
    assert.equal(loop.userTexts().length, 1);
    assert.ok(loop.userTexts()[0].startsWith("The session was restarted."));
    assert.equal(loop.actions().at(-1)?.data.result, "confirmed");
  },
);

void test(
  "a busy relaunch types nothing and sets needs_input with resume_failed",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-busy", { logAllKeys: true });
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "resume" }],
      "tmux: pane at shell prompt",
      deps({
        relaunch: () => Promise.resolve("busy"),
        atShellPrompt: () => Promise.resolve(true),
      }),
    );
    assert.deepEqual(await loop.keysSettled(1), []);
    assert.equal(loop.userTexts().length, 0);
    assert.equal(loop.session().state, "needs_input");
    assert.equal(loop.session().stateReason, "resume_failed");
  },
);

void test(
  "a finished card whose session exits and whose relaunch answers busy stays in Agent done with its DONE marker",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-busy-done", {}, true);
    await store.applyMarker(
      loop.card().id,
      loop.session().id,
      "agent_done",
      undefined,
      "DONE built",
      "status_agent_done",
    );
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "resume" }],
      "tmux: pane at shell prompt",
      deps({
        relaunch: () => Promise.resolve("busy"),
        atShellPrompt: () => Promise.resolve(true),
      }),
    );
    assert.equal(loop.userTexts().length, 0);
    assert.equal(loop.card().column, "agent_done");
    assert.equal(loop.card().lastMarker, "DONE built");
    assert.notEqual(loop.session().stateReason, "resume_failed");
    assert.deepEqual(
      loop.actions().map((e) => [e.data.action, e.data.result, e.data.reason]),
      [["resume", "skipped", "run claude busy on a finished card"]],
    );
  },
);

void test(
  "a session at the shell prompt whose workspace folder is missing is not relaunched and sets needs_input with workspace-missing",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-missing-ws", { logAllKeys: true });
    const relaunched: string[] = [];
    const gone = `${loop.root}-gone`;
    fs.renameSync(loop.root, gone);
    try {
      await runActions(
        loop.card(),
        loop.session(),
        [{ kind: "resume" }],
        "tmux: pane at shell prompt",
        deps({
          relaunch: (cardId) => {
            relaunched.push(cardId);
            return Promise.resolve("launched");
          },
          atShellPrompt: () => Promise.resolve(true),
        }),
      );
    } finally {
      fs.renameSync(gone, loop.root);
    }
    assert.deepEqual(relaunched, []);
    assert.deepEqual(await loop.keysSettled(1), []);
    assert.equal(loop.userTexts().length, 0);
    assert.equal(loop.session().state, "needs_input");
    assert.equal(loop.session().stateReason, "resume_failed");
    assert.equal(loop.card().column, "needs_input");
    assert.equal(
      loop.card().statusReason,
      `resume: Resume failed: workspace-missing: ${loop.root}`,
    );
  },
);

void test(
  "a lost session runs the resume saga and never the relaunch",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-lost", {});
    const resumed: string[] = [];
    let relaunched = 0;
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "resume" }],
      "tmux: session not found",
      deps({
        resume: (cardId) => {
          resumed.push(cardId);
          return Promise.resolve();
        },
        relaunch: () => {
          relaunched++;
          return Promise.resolve("launched");
        },
      }),
    );
    assert.deepEqual(resumed, [loop.card().id]);
    assert.equal(relaunched, 0);
  },
);

void test(
  "a resume while a start is in flight records one skipped event and touches nothing else",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-starting", { logAllKeys: true });
    const before = loop.session().state;
    let calls = 0;
    const count = () => {
      calls++;
      return Promise.resolve();
    };
    store.beginStart(loop.card().id);
    try {
      await runActions(
        loop.card(),
        loop.session(),
        [{ kind: "resume" }],
        "tmux: session not found",
        deps({
          resume: count,
          relaunch: () => {
            calls++;
            return Promise.resolve("launched");
          },
          atShellPrompt: () => {
            calls++;
            return Promise.resolve(true);
          },
        }),
      );
    } finally {
      store.endStart(loop.card().id);
    }
    assert.equal(calls, 0);
    assert.deepEqual(
      loop.actions().map((e) => [e.data.action, e.data.result]),
      [["resume", "skipped"]],
    );
    assert.equal(loop.session().state, before);
    assert.notEqual(loop.session().stateReason, "resume_failed");
    assert.equal(loop.userTexts().length, 0);
    assert.deepEqual(await loop.keysSettled(1), []);
  },
);

void test(
  "claude that never leaves the shell prompt after the relaunch gets no text and resume_failed",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("resume-stuck", { logAllKeys: true });
    let relaunched = 0;
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "resume" }],
      "tmux: pane at shell prompt",
      deps({
        relaunch: () => {
          relaunched++;
          return Promise.resolve("launched");
        },
        atShellPrompt: () => Promise.resolve(true),
      }),
    );
    assert.equal(relaunched, 1);
    assert.deepEqual(await loop.keysSettled(1), []);
    assert.equal(loop.userTexts().length, 0);
    assert.equal(loop.session().state, "needs_input");
    assert.equal(loop.session().stateReason, "resume_failed");
  },
);

void test(
  "through the pane sink a stopped loop gets one prompt, then gives up and holds",
  { skip: !hasTmux },
  async () => {
    const { supervisePane } = await import("./supervisor-registry.js");
    const loop = await loopCard("wired", {}, true);
    await store.setLoopProgress(loop.card().id, {
      ...LOOP_PROGRESS,
      engine: {
        active: true,
        iteration: 3,
        sessionId: "s-1",
        handoffPending: false,
        startedAt: null,
        closed: false,
      },
    });
    const name = loop.session().tmuxSession!;
    const sample = async (at: number) =>
      supervisePane(
        {
          cardId: loop.card().id,
          sessionId: loop.session().id,
          tmuxSession: name,
          pane: await capturePane(`=${name}:`),
        },
        at,
      );
    const t0 = Date.now();
    for (const minute of [0, 1, 2]) await sample(t0 + minute * 60_000);
    assert.equal(loop.userTexts().length, 1);
    for (const minute of [3, 4, 5, 6]) await sample(t0 + minute * 60_000);
    assert.equal(loop.userTexts().length, 1);
    assert.equal(loop.session().state, "needs_input");
    assert.equal(loop.session().stateReason, "supervisor_gave_up");
    const rows = () =>
      store
        .listOrchestrationEvents(SBX, 0, 500)
        .filter((e) => e.cardId === loop.card().id);
    const settled = rows().length;
    for (const minute of [7, 8, 9, 10]) await sample(t0 + minute * 60_000);
    assert.equal(rows().length, settled);
    assert.deepEqual(
      rows()
        .filter((e) => e.kind === "supervisor_action")
        .map((e) => e.data.action),
      ["continue", "needs_input"],
    );
  },
);

void test(
  "a second API error gives up once and the error still on screen adds no rows",
  { skip: !hasTmux },
  async () => {
    const { supervisePane } = await import("./supervisor-registry.js");
    const { readFileSync } = await import("node:fs");
    const fixture = (name: string) =>
      readFileSync(
        new URL(`../../test-support/fixtures/panes/${name}`, import.meta.url),
        "utf8",
      );
    const loop = await loopCard("api-flap", {}, true);
    const sample = (pane: string, at: number) =>
      supervisePane(
        {
          cardId: loop.card().id,
          sessionId: loop.session().id,
          tmuxSession: loop.session().tmuxSession!,
          pane,
        },
        at,
      );
    const t0 = Date.now();
    await sample(fixture("api-error.txt"), t0);
    assert.equal(loop.userTexts().length, 1);
    await sample(fixture("working.txt"), t0 + 2_000);
    await sample(fixture("api-error.txt"), t0 + 4_000);
    assert.equal(loop.userTexts().length, 1);
    assert.equal(loop.session().state, "needs_input");
    const rows = () =>
      store
        .listOrchestrationEvents(SBX, 0, 500)
        .filter((e) => e.cardId === loop.card().id).length;
    const settled = rows();
    for (let i = 1; i <= 10; i++)
      await sample(fixture("api-error.txt"), t0 + 4_000 + i * 2_000);
    assert.equal(rows(), settled);
    assert.equal(loop.session().state, "needs_input");
  },
);

void test(
  "an API error right after boot counts under the real unit and phase, so the next one gives up",
  { skip: !hasTmux },
  async () => {
    const { supervisePane } = await import("./supervisor-registry.js");
    const { readFileSync } = await import("node:fs");
    const fixture = (name: string) =>
      readFileSync(
        new URL(`../../test-support/fixtures/panes/${name}`, import.meta.url),
        "utf8",
      );
    const loop = await loopCard("boot-budget", {}, true, "g14-partial");
    assert.equal(loop.card().loopProgress, undefined);
    const sample = (pane: string, at: number) =>
      supervisePane(
        {
          cardId: loop.card().id,
          sessionId: loop.session().id,
          tmuxSession: loop.session().tmuxSession!,
          pane,
        },
        at,
      );
    const t0 = Date.now();
    await sample(fixture("api-error.txt"), t0);
    assert.ok(loop.card().loopProgress?.summary.currentPhase);
    assert.equal(loop.userTexts().length, 1);
    await sample(fixture("working.txt"), t0 + 2_000);
    await sample(fixture("api-error.txt"), t0 + 4_000);
    assert.equal(loop.userTexts().length, 1);
    assert.equal(loop.session().stateReason, "supervisor_gave_up");
  },
);

void test(
  "a limit_move action runs move-or-wait and, with no account under the headroom line, waits for the printed reset",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("limit-move", {});
    const { actions } = planActions({
      from: "working",
      to: "usage_limit_wait",
      loop: { engineActive: true, handoffPending: false, unitPhase: "1/3" },
      usageLimit: "wait",
      wokeAt: null,
      now: Date.now(),
      memory: initialPlanMemory(),
    });
    assert.deepEqual(actions, [{ kind: "limit_move" }]);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000);
    const resetDay = `${tomorrow.toLocaleString("en-US", { month: "short" })} ${tomorrow.getDate()}`;
    await runActions(
      loop.card(),
      loop.session(),
      actions,
      `transcript: You've hit your weekly limit · resets ${resetDay} at 8:30am (Asia/Calcutta)`,
    );
    const wait = loop.actions().find((e) => e.data.action === "limit_wait");
    assert.equal(wait?.data.reason, "no_headroom");
    assert.equal(wait?.data.source, "transcript");
    assert.equal(wait?.data.mode, "continue");
    assert.ok(!loop.actions().some((e) => e.data.action === "limit_move"));
    assert.deepEqual(loop.userTexts(), []);
  },
);

const SINCE = "2026-10-21T10:00:00.000Z";
const JOB = 5100;

function frozenDeps(startsAtPrompt: boolean, exits: boolean) {
  const calls = {
    kill: [] as [number, string][],
    relaunch: 0,
    sends: [] as { text: string; kind: string }[],
  };
  let atPrompt = startsAtPrompt;
  const overrides: Partial<ActionDeps> = {
    paneTerminal: () =>
      Promise.resolve({ pgid: 5000, tpgid: atPrompt ? 5000 : JOB }),
    kill: (pid, signal) => {
      calls.kill.push([pid, signal]);
      if (exits) atPrompt = true;
    },
    relaunch: () => {
      calls.relaunch++;
      atPrompt = false;
      return Promise.resolve("launched");
    },
    atShellPrompt: () => Promise.resolve(atPrompt),
    send: (_card, _session, text, kind) => {
      calls.sends.push({ text, kind });
      return Promise.resolve("confirmed");
    },
    claudeUpMs: 200,
  };
  return { calls, deps: deps(overrides) };
}

const frozenEvents = (loop: Awaited<ReturnType<typeof loopCard>>) =>
  loop.actions().filter((e) => e.data.action === "relaunch_frozen");

void test(
  "a frozen claude gets SIGHUP, a relaunch with resume and one resume prompt",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-frozen", {});
    const { calls, deps: injected } = frozenDeps(false, true);
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "relaunch_frozen", frozenSince: SINCE }],
      "pane: frozen",
      injected,
    );
    assert.deepEqual(calls.kill, [[-JOB, "SIGHUP"]]);
    assert.equal(calls.relaunch, 1);
    assert.equal(calls.sends.length, 1);
    assert.equal(calls.sends[0].kind, "resume");
    assert.ok(calls.sends[0].text.startsWith("The session was restarted."));
    assert.equal(frozenEvents(loop).length, 1);
    assert.equal(frozenEvents(loop)[0].data.result, "stopped");
    assert.equal(frozenEvents(loop)[0].data.frozenSince, SINCE);
    assert.equal(
      loop.actions().filter((e) => e.data.action === "resume").length,
      1,
    );
    assert.equal(
      store
        .listEvents(SBX, loop.card().id, 50)
        .filter((e) => e.type === "session_relaunch").length,
      1,
    );
  },
);

void test(
  "a frozen session whose shell is already at the prompt is not signalled",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-at-prompt", {});
    const { calls, deps: injected } = frozenDeps(true, true);
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "relaunch_frozen", frozenSince: SINCE }],
      "pane: frozen",
      injected,
    );
    assert.deepEqual(calls.kill, []);
    assert.equal(calls.relaunch, 1);
  },
);

void test(
  "a claude that ignores SIGHUP and SIGKILL is not relaunched and gets resume_failed",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-stuck", {});
    const { calls, deps: injected } = frozenDeps(false, false);
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "relaunch_frozen", frozenSince: SINCE }],
      "pane: frozen",
      injected,
    );
    assert.deepEqual(calls.kill, [
      [-JOB, "SIGHUP"],
      [-JOB, "SIGKILL"],
    ]);
    assert.equal(calls.relaunch, 0);
    assert.equal(frozenEvents(loop).length, 1);
    assert.equal(frozenEvents(loop)[0].data.result, "failed");
    assert.equal(frozenEvents(loop)[0].data.reason, "claude did not exit");
    assert.equal(loop.session().stateReason, "resume_failed");
    assert.equal(
      store
        .listEvents(SBX, loop.card().id, 50)
        .filter((e) => e.type === "session_relaunch").length,
      0,
    );
  },
);

void test(
  "a relaunch that never reaches the prompt send writes no session_relaunch event",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-busy", {});
    const { calls, deps: injected } = frozenDeps(false, true);
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "relaunch_frozen", frozenSince: SINCE }],
      "pane: frozen",
      { ...injected, relaunch: () => Promise.resolve("busy") },
    );
    assert.equal(calls.sends.length, 0);
    assert.equal(frozenEvents(loop)[0].data.result, "stopped");
    assert.equal(loop.session().stateReason, "resume_failed");
    assert.equal(
      store
        .listEvents(SBX, loop.card().id, 50)
        .filter((e) => e.type === "session_relaunch").length,
      0,
    );
  },
);

void test(
  "under memory pressure a frozen relaunch sends no signal and fails before any stop",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-memory", {});
    const { calls, deps: injected } = frozenDeps(false, true);
    recordMemory(812, 1000);
    try {
      await runActions(
        loop.card(),
        loop.session(),
        [{ kind: "relaunch_frozen", frozenSince: SINCE }],
        "pane: frozen",
        injected,
      );
    } finally {
      recordMemory(2048, 1000);
    }
    assert.deepEqual(calls.kill, []);
    assert.equal(calls.relaunch, 0);
    assert.equal(frozenEvents(loop)[0].data.result, "failed");
    assert.equal(
      frozenEvents(loop)[0].data.reason,
      "free memory 812 MB is below the 1024 MB floor",
    );
    assert.equal(loop.session().stateReason, "resume_failed");
  },
);

void test(
  "a frozen relaunch on a pane with no shell root sends no signal and fails",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-no-root", {});
    const { calls, deps: injected } = frozenDeps(false, true);
    await runActions(
      loop.card(),
      loop.session(),
      [{ kind: "relaunch_frozen", frozenSince: SINCE }],
      "pane: frozen",
      { ...injected, shellRoot: () => Promise.resolve(false) },
    );
    assert.deepEqual(calls.kill, []);
    assert.equal(frozenEvents(loop)[0].data.result, "failed");
    assert.equal(frozenEvents(loop)[0].data.reason, "no shell root");
    assert.equal(loop.session().stateReason, "resume_failed");
  },
);

void test(
  "a frozen relaunch whose workspace folder is missing sends no signal and fails with workspace-missing",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-missing-ws", {});
    const { calls, deps: injected } = frozenDeps(false, true);
    const gone = `${loop.root}-gone`;
    fs.renameSync(loop.root, gone);
    try {
      await runActions(
        loop.card(),
        loop.session(),
        [{ kind: "relaunch_frozen", frozenSince: SINCE }],
        "pane: frozen",
        injected,
      );
    } finally {
      fs.renameSync(gone, loop.root);
    }
    assert.deepEqual(calls.kill, []);
    assert.equal(calls.relaunch, 0);
    assert.equal(frozenEvents(loop)[0].data.result, "failed");
    assert.equal(
      frozenEvents(loop)[0].data.reason,
      `workspace-missing: ${loop.root}`,
    );
    assert.equal(loop.session().stateReason, "resume_failed");
  },
);

void test(
  "a frozen relaunch on a paused card records skipped and sends no signal",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-paused", {});
    const { calls, deps: injected } = frozenDeps(false, true);
    const stale = loop.card();
    await store.markCardPaused(stale.id, loop.session().id, {
      at: "2026-10-21T00:00:00.000Z",
      by: "user",
      sessionId: loop.session().id,
      pids: [101],
    });
    try {
      await runActions(
        stale,
        loop.session(),
        [{ kind: "relaunch_frozen", frozenSince: SINCE }],
        "pane: frozen",
        injected,
      );
    } finally {
      await store.clearCardPaused(stale.id);
    }
    assert.deepEqual(calls.kill, []);
    assert.equal(calls.relaunch, 0);
    assert.equal(frozenEvents(loop).length, 1);
    assert.equal(frozenEvents(loop)[0].data.result, "skipped");
    assert.notEqual(loop.session().stateReason, "resume_failed");
  },
);

void test(
  "a frozen relaunch for a changed tmux session or a held card lock records skipped and sends no signal",
  { skip: !hasTmux },
  async () => {
    const { withCardLock } = await import("./card-lock.js");
    const loop = await loopCard("relaunch-stale", {});
    const { calls, deps: injected } = frozenDeps(false, true);
    const relaunch = (session: ReturnType<typeof loop.session>) =>
      runActions(
        loop.card(),
        session,
        [{ kind: "relaunch_frozen", frozenSince: SINCE }],
        "pane: frozen",
        injected,
      );
    await relaunch({ ...loop.session(), tmuxSession: "dsp-other" });
    let release = () => {};
    const held = withCardLock(
      loop.card().id,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    try {
      await relaunch(loop.session());
    } finally {
      release();
      await held;
    }
    assert.deepEqual(calls.kill, []);
    assert.equal(calls.relaunch, 0);
    assert.deepEqual(
      frozenEvents(loop).map((e) => [e.data.result, e.data.reason]),
      [
        ["skipped", "the tmux session changed"],
        ["skipped", "card busy"],
      ],
    );
    assert.notEqual(loop.session().stateReason, "resume_failed");
  },
);

void test(
  "a frozen relaunch while a start is in flight records skipped and sends no signal",
  { skip: !hasTmux },
  async () => {
    const loop = await loopCard("relaunch-starting", {});
    const { calls, deps: injected } = frozenDeps(false, true);
    store.beginStart(loop.card().id);
    try {
      await runActions(
        loop.card(),
        loop.session(),
        [{ kind: "relaunch_frozen", frozenSince: SINCE }],
        "pane: frozen",
        injected,
      );
    } finally {
      store.endStart(loop.card().id);
    }
    assert.deepEqual(calls.kill, []);
    assert.equal(frozenEvents(loop)[0].data.result, "skipped");
    assert.notEqual(loop.session().stateReason, "resume_failed");
  },
);
