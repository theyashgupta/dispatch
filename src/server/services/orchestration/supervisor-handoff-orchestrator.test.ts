import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const {
  checkHandoffThreshold,
  orchestratorHandoffRequestText,
  orchestratorResumePromptText,
} = await import("./supervisor-handoff.js");
const { supervisePane } = await import("./supervisor-registry.js");
const { SBX, setupSupervisedBoard, startSupervised, stopSupervisedTmux } =
  await import("../../test-support/supervised-session.js");
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

/** Start an orchestrator session whose transcripts sit in their own project folder. */
async function orchestratorSession(title: string) {
  const s = await startSupervised({
    tmpRoot: env.root,
    title,
    orchestrator: "lead",
    scenario: { logAllKeys: true },
  });
  const project = path.join(s.root, "projects", `-${title}`);
  fs.mkdirSync(project, { recursive: true });
  const first = path.join(project, "conv-first.jsonl");
  fs.writeFileSync(first, "");
  await s.setScenario({ transcriptPath: first, transcriptDir: project });
  await store.setTranscriptPath(s.card().id, s.session().id, first);
  const patch = async (change: Record<string, unknown>) => {
    const board = store.getBoard(SBX)!;
    await store.setBoardOrchestrators(
      SBX,
      board.orchestrators.map((r) => ({ ...r, ...change })),
    );
  };
  const record = () => store.getBoard(SBX)!.orchestrators[0];
  return { ...s, project, first, patch, record };
}

const sampleOf =
  (s: Awaited<ReturnType<typeof orchestratorSession>>) => async () =>
    supervisePane(
      {
        cardId: s.card().id,
        sessionId: s.session().id,
        tmuxSession: s.name,
        pane: await s.pane(),
      },
      Date.now(),
    );

void test("the request text tells the orchestrator to call write_state with handoffReady and print the id", () => {
  const soft = orchestratorHandoffRequestText("lead", false);
  const hard = orchestratorHandoffRequestText("lead", true);
  for (const text of [soft, hard]) {
    assert.ok(text.includes("write_state"));
    assert.ok(text.includes("handoffReady set to true"));
    assert.ok(text.includes("HANDOFF_READY lead"));
    assert.ok(text.startsWith("Context handoff request"));
  }
  assert.ok(hard.includes("Hand off now"));
  assert.ok(soft.includes("Do not interrupt in-flight work"));
});

void test("the resume prompt names the orchestrator and the board and lists the tools to read first", () => {
  assert.equal(
    orchestratorResumePromptText("lead", "SBX"),
    "Resume as the lead orchestrator of board SBX. Before any action call read_state, then list_cards, list_events and the open decision items; act only on what the tools return.",
  );
});

void test(
  "a running orchestrator at 72 percent gets exactly one handoff request that names write_state",
  { skip: !hasTmux },
  async () => {
    const s = await orchestratorSession("orch-soft");
    await store.setSessionMetersIfSession(s.card().id, s.name, METERS(72));
    await checkHandoffThreshold(s.card(), s.session(), POLICY);
    await checkHandoffThreshold(s.card(), s.session(), POLICY);
    const sent = s.userTexts(s.first);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].includes("write_state"), sent[0]);
    assert.ok(sent[0].includes("HANDOFF_READY lead"), sent[0]);
    assert.equal(
      s.actions().filter((e) => e.data.action === "handoff_request").length,
      1,
    );
  },
);

void test(
  "an orchestrator whose record says handoffReady gets no further request",
  { skip: !hasTmux },
  async () => {
    const s = await orchestratorSession("orch-pending");
    await s.patch({ handoffReady: true });
    await store.setSessionMetersIfSession(s.card().id, s.name, METERS(85));
    await checkHandoffThreshold(s.card(), s.session(), POLICY);
    assert.equal(s.userTexts(s.first).length, 0);
    assert.deepEqual(s.actions(), []);
  },
);

void test(
  "a stopped orchestrator gets no handoff request",
  { skip: !hasTmux },
  async () => {
    const s = await orchestratorSession("orch-stopped");
    await s.patch({ state: "stopped" });
    await store.setSessionMetersIfSession(s.card().id, s.name, METERS(85));
    await checkHandoffThreshold(s.card(), s.session(), POLICY);
    assert.equal(s.userTexts(s.first).length, 0);
  },
);

void test(
  "HANDOFF_READY with handoffReady set clears the pane, resumes the orchestrator and resets the flag",
  { skip: !hasTmux },
  async () => {
    const s = await orchestratorSession("orch-run");
    await s.patch({ handoffReady: true });
    await s.setScenario({ transcript: ["⏺ HANDOFF_READY lead"] });
    await sampleOf(s)();
    const fresh = s.session().transcriptPath!;
    assert.notEqual(fresh, s.first);
    assert.equal(path.dirname(fresh), s.project);
    assert.deepEqual(s.userTexts(fresh), [
      orchestratorResumePromptText("lead", SBX),
    ]);
    assert.equal(s.record().handoffReady, false);
    assert.deepEqual(
      s
        .actions()
        .filter((e) => e.data.action === "handoff")
        .map((e) => [e.data.result, e.data.sessionId]),
      [["confirmed", path.basename(fresh, ".jsonl")]],
    );
  },
);

void test(
  "HANDOFF_READY without handoffReady on the record does nothing",
  { skip: !hasTmux },
  async () => {
    const s = await orchestratorSession("orch-unarmed");
    await s.setScenario({ transcript: ["⏺ HANDOFF_READY lead"] });
    await sampleOf(s)();
    assert.notEqual(s.session().state, "handoff_ready");
    assert.deepEqual(await s.keysSettled(1), []);
    assert.equal(s.session().transcriptPath, s.first);
    assert.equal(s.record().handoffReady, undefined);
  },
);
