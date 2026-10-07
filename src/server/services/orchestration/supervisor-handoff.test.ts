import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { sendKeys, sendLiteral } = await import("../../adapters/tmux.js");
const {
  checkHandoffCancel,
  checkHandoffThreshold,
  handoffRequestText,
  runFreshSession,
} = await import("./supervisor-handoff.js");
const { escapeLimit } = await import("./supervisor-limit.js");
const { CREDITS_OPTION } = await import("../domain/limit-surface.js");
const { supervisePane } = await import("./supervisor-registry.js");
const {
  LOOP_PROGRESS,
  SBX,
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

const POLICY = { handoffPercent: 50, handoffHardPercent: 80 };
const METERS = (contextPercent: number) => ({
  contextPercent,
  model: "Opus 5.5",
  cost: 1,
  usage: { fiveHourPercent: 10, sevenDayPercent: 10 },
});

const ENGINE = (sessionId: string) => ({
  active: true,
  iteration: 4,
  sessionId,
  handoffPending: sessionId === "handoff-pending",
  startedAt: null,
  closed: false,
});

/** Start a group loop whose transcripts sit in their own project folder, as Claude Code lays them out. */
async function loopSession(title: string, engineId: string) {
  const s = await startSupervised({
    tmpRoot: env.root,
    title,
    group: true,
    scenario: { logAllKeys: true },
  });
  const project = path.join(s.root, "projects", `-${title}`);
  fs.mkdirSync(project, { recursive: true });
  const first = path.join(project, "conv-first.jsonl");
  fs.writeFileSync(first, "");
  const engine = path.join(s.root, ".claude", "ralph-loop.local.md");
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  fs.writeFileSync(
    engine,
    `---\nactive: true\niteration: 4\nsession_id: ${engineId}\n---\n\nprompt\n`,
  );
  await s.setScenario({
    transcriptPath: first,
    transcriptDir: project,
    engineFile: engine,
  });
  await store.setTranscriptPath(s.card().id, s.session().id, first);
  await store.setLoopProgress(s.card().id, {
    ...LOOP_PROGRESS,
    engine: ENGINE(engineId),
  });
  return { ...s, project, first, engine };
}

async function waitUntil(check: () => boolean, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 200));
}

void test(
  "a session at 72 percent with handoffPercent 50 gets exactly one handoff request",
  { skip: !hasTmux },
  async () => {
    const s = await loopSession("handoff-soft", "conv-first");
    await store.setSessionMetersIfSession(s.card().id, s.name, METERS(72));
    await checkHandoffThreshold(s.card(), s.session(), POLICY);
    await checkHandoffThreshold(s.card(), s.session(), POLICY);
    const sent = s.userTexts(s.first);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /-handoff\.md and follow it\.$/);
    const file = sent[0].replace(/^Read /, "").replace(/ and follow it\.$/, "");
    const request = fs.readFileSync(file, "utf8");
    assert.ok(
      request.startsWith("Context handoff request. Your context is high."),
    );
    assert.ok(request.includes(`HANDOFF_READY ${LOOP_PROGRESS.slug}`));
    assert.ok(
      request.includes(path.join(s.root, ".claude", "ralph-loop.local.md")),
    );
    const requests = s
      .actions()
      .filter((e) => e.data.action === "handoff_request");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].data.hard, false);
  },
);

void test(
  "at 85 percent with no handoff yet the hard request is sent once",
  { skip: !hasTmux },
  async () => {
    const s = await loopSession("handoff-hard", "conv-first");
    await store.setSessionMetersIfSession(s.card().id, s.name, METERS(85));
    await checkHandoffThreshold(s.card(), s.session(), POLICY);
    await checkHandoffThreshold(s.card(), s.session(), POLICY);
    const sent = s.userTexts(s.first);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /-handoff-hard\.md and follow it\.$/);
    assert.deepEqual(
      s.actions().map((e) => e.data.hard),
      [true],
    );
  },
);

void test(
  "the crossing re-arms when the meter falls under the threshold",
  { skip: !hasTmux },
  async () => {
    const s = await loopSession("handoff-rearm", "conv-first");
    for (const percent of [60, 40, 61]) {
      await store.setSessionMetersIfSession(
        s.card().id,
        s.name,
        METERS(percent),
      );
      await checkHandoffThreshold(s.card(), s.session(), POLICY);
    }
    assert.equal(s.userTexts(s.first).length, 2);
  },
);

void test(
  "at handoff_ready the supervisor clears, resumes and the engine holds the new session id",
  { skip: !hasTmux },
  async () => {
    const s = await loopSession("handoff-run", "handoff-pending");
    await s.setScenario({
      transcript: [`⏺ HANDOFF_READY ${LOOP_PROGRESS.slug}`],
    });
    const sample = async (at: number) =>
      supervisePane(
        {
          cardId: s.card().id,
          sessionId: s.session().id,
          tmuxSession: s.name,
          pane: await s.pane(),
        },
        at,
      );
    await sample(Date.now());
    const fresh = s.session().transcriptPath!;
    assert.notEqual(fresh, s.first);
    assert.equal(path.dirname(fresh), s.project);
    const id = path.basename(fresh, ".jsonl");
    assert.match(
      fs.readFileSync(s.engine, "utf8"),
      new RegExp(`^session_id: ${id}$`, "m"),
    );
    const resume = s.userTexts(fresh);
    assert.equal(resume.length, 1);
    const handoff = s.actions().filter((e) => e.data.action === "handoff");
    assert.deepEqual(
      handoff.map((e) => [e.data.result, e.data.sessionId]),
      [["confirmed", id]],
    );
    const typed = s
      .keys()
      .map((k) => String(k.key))
      .filter((k) => k.startsWith("char:"))
      .map((k) => k.slice(5))
      .join("");
    assert.equal(typed.split("/clear").length - 1, 1);

    await sendLiteral(
      `=${s.name}:`,
      "Context handoff request. Your context is high.",
    );
    await sendKeys(`=${s.name}:`, ["Enter"]);
    await waitUntil(() => s.userTexts(fresh).length === 2);
    await checkHandoffCancel(s.card(), s.session(), Date.now());
    await checkHandoffCancel(s.card(), s.session(), Date.now());
    const after = s.userTexts(fresh);
    assert.equal(after.length, 3);
    assert.ok(after[2].startsWith("Ignore the context handoff request above"));
    assert.equal(
      s.actions().filter((e) => e.data.action === "handoff_cancel").length,
      1,
    );
  },
);

void test(
  "HANDOFF_READY without handoff-pending in the engine does nothing",
  { skip: !hasTmux },
  async () => {
    const s = await loopSession("handoff-unarmed", "conv-first");
    await s.setScenario({
      transcript: [`⏺ HANDOFF_READY ${LOOP_PROGRESS.slug}`],
    });
    await supervisePane(
      {
        cardId: s.card().id,
        sessionId: s.session().id,
        tmuxSession: s.name,
        pane: await s.pane(),
      },
      Date.now(),
    );
    assert.notEqual(s.session().state, "handoff_ready");
    assert.deepEqual(await s.keysSettled(1), []);
    assert.equal(s.session().transcriptPath, s.first);
    assert.deepEqual(s.actions(), []);
  },
);

void test("the hard request says to hand off now and the soft one still says not to interrupt", () => {
  const hard = handoffRequestText("sbx-loop", "/root", true);
  const soft = handoffRequestText("sbx-loop", "/root", false);
  assert.match(hard, /^Context handoff request \(hard limit\)\./);
  assert.ok(hard.includes("Hand off now"));
  assert.ok(!hard.includes("Do not interrupt in-flight work"));
  assert.ok(soft.includes("Do not interrupt in-flight work"));
  assert.ok(!soft.includes("Hand off now"));
  for (const text of [hard, soft]) {
    assert.ok(text.includes("HANDOFF_READY sbx-loop"));
    assert.ok(text.includes("/root/.claude/ralph-loop.local.md"));
  }
});

void test(
  "the fresh reset timer clears and sends the resume prompt into the pane",
  { skip: !hasTmux },
  async () => {
    store.getBoard(SBX)!.policy.supervisor = "on";
    store.getBoard(SBX)!.policy.usageLimit = "wait";
    const s = await loopSession("handoff-limit-fresh", "handoff-pending");
    await s.setScenario({
      prompt: "",
      transcript: [
        "  ⚠ Usage limit reached · limit resets 11:40pm · clau.de/wrap-up",
        "    Continuing automatically at 11:40pm · esc to cancel",
      ],
    });
    const timers: (() => void)[] = [];
    await escapeLimit(s.card(), s.session(), {
      now: () => new Date(2026, 9, 6, 22, 0).getTime(),
      schedule: (run) => {
        timers.push(run);
      },
      usageResetAt: () => null,
      cursorWaitMs: 2_000,
    });
    assert.equal(timers.length, 1);
    assert.deepEqual(
      (await s.keysSettled(1)).map((k) => k.key),
      ["esc"],
    );
    await s.setScenario({ prompt: "❯ ", transcript: [] });
    timers[0]();
    await waitUntil(() => s.actions().some((e) => e.data.action === "handoff"));
    const typed = s
      .keys()
      .map((k) => String(k.key))
      .filter((k) => k.startsWith("char:"))
      .map((k) => k.slice(5))
      .join("");
    assert.equal(typed.split("/clear").length - 1, 1);
    assert.match(typed, /-resume\.md and follow it\.$/);
    const fresh = s.session().transcriptPath!;
    assert.notEqual(fresh, s.first);
    assert.equal(s.userTexts(fresh).length, 1);
    const file = s
      .userTexts(fresh)[0]
      .replace(/^Read /, "")
      .replace(/ and follow it\.$/, "");
    assert.ok(
      fs.readFileSync(file, "utf8").startsWith("Resume the sbx-loop loop."),
    );
    assert.deepEqual(
      s
        .actions()
        .filter((e) => e.data.action === "handoff")
        .map((e) => e.data.result),
      ["confirmed"],
    );
    for (const key of s.keys()) {
      if (key.key === "enter")
        assert.doesNotMatch(String(key.row), CREDITS_OPTION);
    }
  },
);

void test(
  "a session held at needs_input with reason budget gets no handoff request while the pane reads working",
  { skip: !hasTmux },
  async () => {
    const s = await loopSession("handoff-held", "conv-first");
    await s.setScenario({ transcript: ["✽ Boondoggling… (1m 2s)"] });
    await store.setSessionMetersIfSession(s.card().id, s.name, METERS(85));
    await store.setSessionStateIfSession(
      s.card().id,
      s.session().id,
      "needs_input",
      "budget",
    );
    const sample = async () =>
      supervisePane(
        {
          cardId: s.card().id,
          sessionId: s.session().id,
          tmuxSession: s.name,
          pane: await s.pane(),
        },
        Date.now(),
      );
    await sample();
    assert.equal(s.session().stateReason, "budget");
    assert.equal(s.userTexts(s.first).length, 0);
    assert.deepEqual(
      s.actions().filter((e) => e.data.action === "handoff_request"),
      [],
    );
    assert.ok(!s.keys().some((k) => String(k.key).startsWith("char:")));
    await store.setSessionStateIfSession(
      s.card().id,
      s.session().id,
      "working",
    );
    await sample();
    assert.equal(
      s.actions().filter((e) => e.data.action === "handoff_request").length,
      1,
    );
  },
);

const SHORT_TIMING = {
  readyMs: 5_000,
  engineMs: 1_500,
  cancelWindowMs: 5 * 60_000,
  pollMs: 100,
};

const handoffActions = (s: Awaited<ReturnType<typeof loopSession>>) =>
  s.actions().filter((e) => e.data.action === "handoff");

void test(
  "a dialog that opens between the typed /clear and its Enter gets no Enter and ends at supervisor_gave_up",
  { skip: !hasTmux },
  async () => {
    const s = await loopSession("handoff-dialog", "handoff-pending");
    const typedClear = () =>
      s
        .keys()
        .map((k) => String(k.key))
        .filter((k) => k.startsWith("char:"))
        .map((k) => k.slice(5))
        .join("")
        .includes("/clear");
    const injected = (async () => {
      while (!typedClear()) await new Promise((r) => setTimeout(r, 25));
      await s.setScenario({
        prompt: "",
        transcript: ["❯ run it"],
        dialog: { title: "Do you want to proceed?", rows: ["1. Yes", "2. No"] },
      });
    })();
    const [ok] = await Promise.all([
      runFreshSession(s.card(), s.session(), SHORT_TIMING),
      injected,
    ]);
    assert.equal(ok, false);
    const keys = s.keys().map((k) => String(k.key));
    const lastChar = keys.map((k) => k.startsWith("char:")).lastIndexOf(true);
    assert.ok(lastChar >= 0);
    assert.ok(!keys.slice(lastChar + 1).includes("enter"));
    assert.ok(!keys.includes("enter"));
    assert.deepEqual(
      handoffActions(s).map((e) => [e.data.result, e.data.step]),
      [["unconfirmed", "clear"]],
    );
    assert.equal(s.session().state, "needs_input");
    assert.equal(s.session().stateReason, "supervisor_gave_up");
    assert.equal(s.session().transcriptPath, s.first);
  },
);

void test(
  "an engine file that never names the fresh transcript leaves the transcript path alone and gives up",
  { skip: !hasTmux },
  async () => {
    const s = await loopSession("handoff-engine-wait", "handoff-pending");
    await s.setScenario({ engineFile: undefined });
    const ok = await runFreshSession(s.card(), s.session(), SHORT_TIMING);
    assert.equal(ok, false);
    assert.equal(s.userTexts(s.first).length, 0);
    const fresh = fs
      .readdirSync(s.project)
      .filter((f) => f !== path.basename(s.first));
    assert.equal(fresh.length, 1);
    assert.equal(s.userTexts(path.join(s.project, fresh[0])).length, 1);
    assert.deepEqual(
      handoffActions(s).map((e) => [e.data.result, e.data.step]),
      [["unconfirmed", "engine session id"]],
    );
    assert.equal(s.session().transcriptPath, s.first);
    assert.match(
      fs.readFileSync(s.engine, "utf8"),
      /^session_id: handoff-pending$/m,
    );
    assert.equal(s.session().state, "needs_input");
    assert.equal(s.session().stateReason, "supervisor_gave_up");
  },
);
