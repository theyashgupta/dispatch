import test, { after } from "node:test";
import assert from "node:assert/strict";
import { parseBoardKey } from "../../../shared/board-key.js";
import type {
  BoardKey,
  BoardPolicy,
  Card,
  SupervisorState,
  SupervisorStateReason,
} from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";
import {
  ConflictError,
  PolicyError,
  ValidationError,
} from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { LOOP_PROGRESS } =
  await import("../../test-support/supervised-session.js");
const {
  approveGroupPlan,
  requestHandoff,
  resumeLoop,
  sendInput,
  sessionTools,
  stopSession,
} = await import("./orchestrator-sessions.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const CALLER = { boardKey: SBX, orchestratorId: "orc-sbx" };
const sent: { text: string; kind: string }[] = [];
const keys: string[][] = [];
sessionTools.send = (_card, _session, text, kind) => {
  sent.push({ text, kind });
  return Promise.resolve("confirmed");
};
sessionTools.keys = (_target, pressed) => {
  keys.push([...pressed]);
  return Promise.resolve();
};

await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});
after(() => env.cleanup());

async function setPolicy(patch: Partial<BoardPolicy>): Promise<void> {
  await store.setBoardPolicy(SBX, { ...store.getBoard(SBX)!.policy, ...patch });
}

/** A live group card, with the session state and reason when given. */
async function liveGroup(
  state?: SupervisorState,
  reason?: SupervisorStateReason,
): Promise<Card> {
  const { g } = await startedGroup(store, { board: SBX });
  await store.setLoopProgress(g.id, LOOP_PROGRESS);
  if (state !== undefined) {
    await store.setSessionStateIfSession(
      g.id,
      g.activeSessionId!,
      state,
      reason,
    );
  }
  return store.getCard(g.id)!;
}

const sessionOf = (card: Card) =>
  store.getCard(card.id)!.sessions!.find((s) => s.id === card.activeSessionId)!;

void test("sendInput types the text through the confirmed send and returns its result", async () => {
  const card = await liveGroup("working");
  sent.length = 0;
  assert.equal(await sendInput(CALLER, card, "use option two"), "confirmed");
  assert.deepEqual(sent, [
    { text: "use option two", kind: "orchestrator_input" },
  ]);
});

void test("sendInput refuses a keyless state, a user stop, a mode character and a card with no session, and sends nothing", async () => {
  sent.length = 0;
  const prompt = await liveGroup("permission_prompt");
  await assert.rejects(
    sendInput(CALLER, prompt, "x"),
    (err) =>
      err instanceof ConflictError && err.code === "session-state-refused",
  );
  const stopped = await liveGroup("needs_input", "budget");
  await assert.rejects(
    sendInput(CALLER, stopped, "x"),
    (err) =>
      err instanceof PolicyError && err.details?.reason === "user must resume",
  );
  const working = await liveGroup("working");
  await assert.rejects(
    sendInput(CALLER, working, "!rm -rf"),
    (err) => err instanceof ValidationError && err.code === "invalid-text",
  );
  const plain = await store.createLocalCard(SBX, "plain", "");
  await assert.rejects(
    sendInput(CALLER, plain, "x"),
    (err) => err instanceof ConflictError && err.code === "no-live-session",
  );
  assert.deepEqual(sent, []);
});

void test("sendInput refuses a second call on the same card while the first runs", async () => {
  const card = await liveGroup("working");
  const release: { done: () => void } = { done: () => undefined };
  const original = sessionTools.send;
  sessionTools.send = () =>
    new Promise((resolve) => {
      release.done = () => resolve("confirmed");
    });
  try {
    const first = sendInput(CALLER, card, "first");
    await assert.rejects(
      sendInput(CALLER, card, "second"),
      (err) => err instanceof ConflictError && err.code === "session-busy",
    );
    release.done();
    assert.equal(await first, "confirmed");
  } finally {
    sessionTools.send = original;
  }
});

void test("approveGroupPlan sends the approval at the all level and refuses ask with no answered item", async () => {
  const card = await liveGroup("working");
  sent.length = 0;
  await setPolicy({ roadmapApproval: "all" });
  assert.equal(await approveGroupPlan(CALLER, card, ["dec-1"]), "confirmed");
  assert.deepEqual(sent, [
    {
      text: "Roadmap approved (decisions dec-1). Continue the loop.",
      kind: "roadmap_approval",
    },
  ]);
  await setPolicy({ roadmapApproval: "ask" });
  sent.length = 0;
  await assert.rejects(
    approveGroupPlan(CALLER, card, ["dec-1"]),
    (err) =>
      err instanceof PolicyError &&
      err.details?.reason ===
        "roadmap approval needs an answered approve item from the user",
  );
  const plain = await store.createLocalCard(SBX, "plain", "");
  await assert.rejects(
    approveGroupPlan(CALLER, plain, ["dec-1"]),
    ValidationError,
  );
  assert.deepEqual(sent, []);
});

void test("requestHandoff sends the handoff request and refuses a card with no loop", async () => {
  const card = await liveGroup("working");
  sent.length = 0;
  assert.equal(await requestHandoff(card, true), "confirmed");
  assert.equal(sent[0]?.kind, "handoff-hard");
  assert.match(
    sent[0]?.text ?? "",
    /^Context handoff request \(hard limit\)\./,
  );
  await store.setLoopProgress(card.id, { ...LOOP_PROGRESS, slug: "" });
  sent.length = 0;
  await assert.rejects(
    requestHandoff(store.getCard(card.id)!, false),
    (err) => err instanceof ConflictError && err.code === "no-loop",
  );
  assert.deepEqual(sent, []);
});

void test("resumeLoop continues a stopped loop and marks the session working", async () => {
  await setPolicy({ concurrencyCap: 50, budgetPerGroup: null });
  const card = await liveGroup("needs_input", "stop_session");
  sent.length = 0;
  assert.equal(await resumeLoop(CALLER, card), "confirmed");
  assert.equal(sent[0]?.kind, "resume");
  assert.match(sent[0]?.text ?? "", /^The session was restarted\./);
  assert.equal(sessionOf(card).state, "working");
  assert.equal(sessionOf(card).stateReason, undefined);
});

void test("resumeLoop refuses a working session, a user stop and a full cap, and sends nothing", async () => {
  sent.length = 0;
  const working = await liveGroup("working");
  await assert.rejects(
    resumeLoop(CALLER, working),
    (err) => err instanceof ConflictError && err.code === "not-resumable",
  );
  const stopped = await liveGroup("needs_input", "usage_stop");
  await assert.rejects(resumeLoop(CALLER, stopped), PolicyError);
  const parked = await liveGroup("needs_input", "stop_session");
  await setPolicy({ concurrencyCap: 1 });
  await assert.rejects(resumeLoop(CALLER, parked), PolicyError);
  assert.deepEqual(sent, []);
  assert.equal(sessionOf(parked).state, "needs_input");
  await setPolicy({ concurrencyCap: 50 });
});

void test("stopSession presses Escape once and parks the session at needs_input", async () => {
  const card = await liveGroup("working");
  keys.length = 0;
  await stopSession(CALLER, card);
  assert.deepEqual(keys, [["Escape"]]);
  assert.equal(sessionOf(card).state, "needs_input");
  assert.equal(sessionOf(card).stateReason, "stop_session");
  assert.equal(store.getCard(card.id)?.column, "needs_input");
});

void test("stopSession refuses a shell prompt and a running ship flow, and presses no key", async () => {
  keys.length = 0;
  const shell = await liveGroup("shell_prompt");
  await assert.rejects(
    stopSession(CALLER, shell),
    (err) =>
      err instanceof ConflictError && err.code === "session-state-refused",
  );
  const shipping = await liveGroup("working");
  await assert.rejects(
    stopSession(CALLER, {
      ...shipping,
      shipFlow: {
        state: "running",
        rights: "open_prs",
        repository: "/tmp/repo",
        repo: null,
        orchestratorId: "orc-sbx",
        identity: { name: "a", email: "a@example.com" },
        branches: [],
        failedStep: null,
        reason: null,
        decisionId: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      },
    }),
    (err) => err instanceof ConflictError && err.code === "ship-running",
  );
  assert.deepEqual(keys, []);
});
