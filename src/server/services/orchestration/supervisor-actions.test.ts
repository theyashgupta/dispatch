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
const { runActions } = await import("./supervisor-actions.js");
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
    resume: () => Promise.resolve(),
    relaunch: () => Promise.resolve("launched"),
    atShellPrompt: () => Promise.resolve(false),
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
