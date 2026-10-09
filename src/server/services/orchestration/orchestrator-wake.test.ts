import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isolateEnv } from "../../test-support/fixtures.js";
import type {
  Board,
  Card,
  OrchestratorRecord,
  Session,
} from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const wake = await import("./orchestrator-wake.js");
const session = await import("./orchestrator-session.js");
const turn = await import("./session-turn.js");
const { supervisePane } = await import("./supervisor-registry.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { SEND_TIMING } = await import("./supervisor-send.js");
const { setupSupervisedBoard, startSupervised, stopSupervisedTmux, SBX } =
  await import("../../test-support/supervised-session.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

await setupSupervisedBoard();
store.on("orchestration", wake.queueWakeReason);
after(async () => {
  await stopSupervisedTmux();
  env.cleanup();
});

const PANES = new URL("../../test-support/fixtures/panes/", import.meta.url);
const IDLE = readFileSync(new URL("idle.txt", PANES), "utf8");
const BUSY = readFileSync(new URL("working.txt", PANES), "utf8");
const POPUP = readFileSync(new URL("permission-prompt.txt", PANES), "utf8");
const TAIL = ". Read the board state with the dispatch tools and continue.";
const T0 = Date.now();
const MIN = 60_000;

const sent: { id: string; text: string; kind: string }[] = [];
let outcome: "confirmed" | "unconfirmed" = "confirmed";
let hold: Promise<void> | null = null;
wake.wakeTools.send = async (card, _session, text, kind) => {
  sent.push({ id: card.ownerOrchestrator ?? "", text, kind });
  if (hold) await hold;
  return outcome;
};

const policy = (wakeMinutes: number) =>
  store.setBoardPolicy(SBX, {
    ...(store.getBoard(SBX) as Board).policy,
    wakeMinutes,
  });

interface Orch {
  id: string;
  card: Card;
  session: Session;
}
const records = (): OrchestratorRecord[] =>
  (store.getBoard(SBX) as Board).orchestrators;

async function addOrch(
  id: string,
  role: "main" | "extra",
  groupIds: string[] = [],
  state: OrchestratorRecord["state"] = "running",
): Promise<Orch> {
  const card = await store.createOrchestratorCard(SBX, id, id);
  await store.completeStart(card.id, undefined, {
    workspacePath: `/sbx/${id}`,
    tmuxSession: `dsp-${id}`,
    branch: id,
  });
  const live = store.getCard(card.id) as Card;
  const orch = {
    id,
    card: live,
    session: live.sessions?.find(
      (s) => s.id === live.activeSessionId,
    ) as Session,
  };
  await store.setBoardOrchestrators(SBX, [
    ...records(),
    {
      id,
      name: id,
      role,
      scope: { groupIds, ticketIds: [] },
      policyOverride: {},
      cardId: card.id,
      state,
      createdAt: "2026-10-08T00:00:00.000Z",
    },
  ]);
  return orch;
}

const recordOf = (id: string) =>
  records().find((r) => r.id === id) as OrchestratorRecord;
const drive = (o: Orch, pane: string, at: number) =>
  wake.driveWake(
    store.getCard(o.card.id) as Card,
    o.session,
    pane,
    (store.getBoard(SBX) as Board).policy.wakeMinutes,
    at,
  );
const rows = (o: Orch) =>
  store
    .listOrchestrationEvents(SBX, 0, 1000)
    .filter(
      (e) => e.cardId === o.card.id && e.data.action === "orchestrator_wake",
    );
const lineOf = (reasons: string) => `Dispatch wake: ${reasons}${TAIL}`;
const settle = async (until?: () => boolean) => {
  const end = Date.now() + 1000;
  while (until && !until() && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 30));
};
const answer = (o: Orch, decisionId: string, orchestratorId = o.id) =>
  store.appendOrchestrationEvent({
    boardKey: SBX,
    cardId: null,
    sessionId: null,
    kind: "decision_answered",
    data: { decisionId, orchestratorId },
    ts: new Date().toISOString(),
  });
const reset = () => {
  sent.length = 0;
  outcome = "confirmed";
  hold = null;
};

await policy(0);

void test("a decision answer with an idle pane sends the exact line once, writes the row and sets lastWake", async () => {
  reset();
  const o = await addOrch("m-decision", "main");
  answer(o, "dec-1");
  drive(o, IDLE, T0);
  await settle(() => recordOf(o.id).lastWake != null);
  assert.deepEqual(
    sent.map((s) => [s.text, s.kind]),
    [[lineOf("decision dec-1 answered"), "orchestrator_wake"]],
  );
  const [row] = rows(o);
  assert.deepEqual(row?.data.reasons, ["decision dec-1 answered"]);
  assert.equal(row?.data.result, "confirmed");
  assert.deepEqual(recordOf(o.id).lastWake, {
    reasons: ["decision dec-1 answered"],
    at: new Date(T0).toISOString(),
  });
  assert.deepEqual(
    session
      .listOrchestrators(store.getBoard(SBX) as Board)
      .find((v) => v.id === o.id)?.lastWake?.reasons,
    ["decision dec-1 answered"],
  );
  drive(o, IDLE, T0 + 60_000);
  await settle();
  assert.equal(sent.length, 1, "a confirmed reason is not sent twice");
});

void test("a busy, not ready or hook busy pane queues the reason and the first idle sample sends it", async () => {
  reset();
  const o = await addOrch("m-busy", "main");
  answer(o, "dec-2");
  drive(o, BUSY, T0);
  drive(o, POPUP, T0 + 2_000);
  await settle();
  assert.equal(sent.length, 0);
  drive(o, IDLE, T0 + 4_000);
  await settle(() => sent.length > 0);
  assert.deepEqual(
    sent.map((s) => s.text),
    [lineOf("decision dec-2 answered")],
  );
});

void test("a busy hook turn state blocks the line on an idle pane until the turn stops", async () => {
  reset();
  const o = await addOrch("m-hook", "main");
  turn.recordTurnEvent(o.card.id, o.session.id, "UserPromptSubmit", undefined);
  answer(o, "hooked");
  drive(o, IDLE, T0);
  await settle();
  assert.equal(sent.length, 0);
  turn.recordTurnEvent(o.card.id, o.session.id, "Stop", undefined);
  drive(o, IDLE, T0 + 2_000);
  await settle(() => sent.length > 0);
  assert.equal(sent[0]?.text, lineOf("decision hooked answered"));
});

void test("two events inside 20 s give one line with two reasons, and a third waits for the rate limit", async () => {
  reset();
  const o = await addOrch("m-burst", "main");
  answer(o, "a");
  answer(o, "b");
  drive(o, IDLE, T0);
  await settle(() => sent.length > 0);
  assert.deepEqual(
    sent.map((s) => s.text),
    [lineOf("decision a answered, decision b answered")],
  );
  answer(o, "c");
  drive(o, IDLE, T0 + 19_000);
  await settle();
  assert.equal(sent.length, 1);
  drive(o, IDLE, T0 + 20_000);
  await settle(() => sent.length > 1);
  assert.equal(sent[1]?.text, lineOf("decision c answered"));
});

void test("more than five reasons end with and <n> more", async () => {
  reset();
  const o = await addOrch("m-many", "main");
  for (const id of ["1", "2", "3", "4", "5", "6", "7"]) answer(o, id);
  drive(o, IDLE, T0);
  await settle(() => sent.length > 0);
  assert.equal(
    sent[0]?.text,
    lineOf(
      "decision 1 answered, decision 2 answered, decision 3 answered, decision 4 answered, decision 5 answered, and 2 more",
    ),
  );
});

void test("an event the orchestrator already received gives no line", async () => {
  reset();
  const o = await addOrch("m-seen", "main");
  const first = answer(o, "seen");
  wake.recordDelivered(SBX, o.id, [first.id]);
  drive(o, IDLE, T0);
  await settle();
  assert.equal(sent.length, 0);
  const next = answer(o, "fresh");
  assert.ok(next.id > first.id);
  drive(o, IDLE, T0 + 1_000);
  await settle(() => sent.length > 0);
  assert.equal(sent[0]?.text, lineOf("decision fresh answered"));
});

void test("a reason received after it was queued is dropped before the send", async () => {
  reset();
  const o = await addOrch("m-late", "main");
  const event = answer(o, "late");
  drive(o, BUSY, T0);
  wake.recordDelivered(SBX, o.id, [event.id]);
  drive(o, IDLE, T0 + 2_000);
  await settle();
  assert.equal(sent.length, 0);
});

void test("an event that the orchestrator did not receive keeps its reason, even when a later event was received", async () => {
  reset();
  const o = await addOrch("m-filtered", "main");
  const earlier = answer(o, "earlier");
  const later = answer(o, "later");
  assert.ok(later.id > earlier.id);
  wake.recordDelivered(SBX, o.id, [later.id]);
  drive(o, IDLE, T0);
  await settle(() => sent.length > 0);
  assert.equal(sent[0]?.text, lineOf("decision earlier answered"));
});

void test("no line is typed in a session state where typing is wrong, and the reasons stay queued", async () => {
  reset();
  const o = await addOrch("m-state", "main");
  answer(o, "held");
  const withState = (state: Session["state"]) => ({ ...o.session, state });
  const driveAs = (state: Session["state"], at: number) =>
    wake.driveWake(
      store.getCard(o.card.id) as Card,
      withState(state),
      IDLE,
      0,
      at,
    );
  for (const state of ["needs_input", "permission_prompt", "lost"] as const)
    driveAs(state, T0);
  await settle();
  assert.equal(sent.length, 0);
  driveAs("idle", T0 + 1_000);
  await settle(() => sent.length > 0);
  assert.equal(sent[0]?.text, lineOf("decision held answered"));
});

void test("a queued timer reason is dropped when wakeMinutes becomes 0 or a tool call follows it", async () => {
  reset();
  await policy(15);
  const o = await addOrch("m-recheck", "main");
  drive(o, BUSY, T0 + 16 * MIN);
  await policy(0);
  drive(o, IDLE, T0 + 17 * MIN);
  await settle();
  assert.equal(sent.length, 0, "wakeMinutes 0 dropped the queued timer");

  await policy(15);
  drive(o, BUSY, T0 + 18 * MIN);
  store.appendOrchestrationEvent({
    boardKey: SBX,
    cardId: null,
    sessionId: null,
    kind: "tool_call",
    data: { orchestratorId: o.id, tool: "list_cards" },
    ts: new Date(T0 + 40 * MIN).toISOString(),
  });
  drive(o, IDLE, T0 + 41 * MIN);
  await settle();
  assert.equal(sent.length, 0, "a newer tool call dropped the queued timer");
});

void test("an agent_done group event wakes its owner and the main, other states only the owner", async () => {
  reset();
  const a = await store.createLocalCard(SBX, "own a", "");
  const b = await store.createLocalCard(SBX, "own b", "");
  const owned = await store.createGroupCard(SBX, "extra's", [a.id, b.id]);
  assert.ok(owned.ok);
  const c = await store.createLocalCard(SBX, "main a", "");
  const d = await store.createLocalCard(SBX, "main b", "");
  const mains = await store.createGroupCard(SBX, "main's", [c.id, d.id]);
  assert.ok(mains.ok);
  await store.setBoardOrchestrators(
    SBX,
    records().filter((r) => r.role !== "main"),
  );
  const main = await addOrch("m-ship", "main");
  const extra = await addOrch("x-ship", "extra", [owned.card.id]);
  const group = (cardId: string, state: string) =>
    store.appendOrchestrationEvent({
      boardKey: SBX,
      cardId,
      sessionId: null,
      kind: "group_state",
      data: { state, reason: "x" },
      ts: new Date().toISOString(),
    });
  const lines = async (at: number) => {
    sent.length = 0;
    drive(main, IDLE, at);
    drive(extra, IDLE, at);
    await settle();
    return sent.map((m) => [m.id, m.text.slice(15).split(".")[0]]);
  };
  const ident = owned.card.identifier;
  group(owned.card.id, "needs_input");
  assert.deepEqual(await lines(T0), [[extra.id, `${ident} needs_input`]]);
  group(owned.card.id, "agent_done");
  assert.deepEqual(await lines(T0 + MIN), [
    [main.id, `${ident} agent_done`],
    [extra.id, `${ident} agent_done`],
  ]);
  group(mains.card.id, "agent_done");
  assert.deepEqual(await lines(T0 + 2 * MIN), [
    [main.id, `${mains.card.identifier} agent_done`],
  ]);
});

void test("the wake row names the orchestrator", async () => {
  reset();
  const o = await addOrch("m-named", "main");
  answer(o, "named");
  drive(o, IDLE, T0);
  await settle(() => rows(o).length > 0);
  assert.equal(rows(o)[0]?.data.orchestrator, "m-named");
});

void test("a supervisor sample of the orchestrator pane waits while its wake send is in flight", async () => {
  reset();
  const o = await addOrch("m-overlap", "main");
  let release = () => {};
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  answer(o, "slow");
  drive(o, IDLE, T0);
  await settle(() => sent.length > 0);
  const live = store.getCard(o.card.id) as Card;
  assert.equal(wake.wakeInFlight(live), true);
  const sample = () =>
    supervisePane(
      {
        cardId: o.card.id,
        sessionId: o.session.id,
        tmuxSession: o.session.tmuxSession as string,
        pane: POPUP,
      },
      T0,
    );
  const stateNow = () =>
    store.getCard(o.card.id)?.sessions?.find((s) => s.id === o.session.id)
      ?.state;
  const before = stateNow();
  await sample();
  assert.equal(stateNow(), before, "the sample did nothing while in flight");
  release();
  await settle(() => !wake.wakeInFlight(store.getCard(o.card.id) as Card));
  assert.equal(wake.wakeInFlight(store.getCard(o.card.id) as Card), false);
  await sample();
  assert.notEqual(stateNow(), before, "the next sample runs normally");
});

void test("a stopped orchestrator gets no line and its queue is lost", async () => {
  reset();
  const o = await addOrch("m-stopped", "main", [], "stopped");
  answer(o, "nobody");
  drive(o, IDLE, T0);
  await settle();
  assert.equal(sent.length, 0);

  const live = await addOrch("m-flip", "main");
  answer(live, "queued");
  drive(live, BUSY, T0);
  await store.setBoardOrchestrators(
    SBX,
    records().map((r) => (r.id === live.id ? { ...r, state: "stopped" } : r)),
  );
  drive(live, IDLE, T0 + 2_000);
  await store.setBoardOrchestrators(
    SBX,
    records().map((r) => (r.id === live.id ? { ...r, state: "running" } : r)),
  );
  drive(live, IDLE, T0 + 4_000);
  await settle();
  assert.equal(sent.length, 0);
});

void test("stopOrchestrator clears the queue", async () => {
  reset();
  const o = await addOrch("m-stop", "main");
  answer(o, "pending");
  drive(o, BUSY, T0);
  session.orchestratorTools.keys = () => Promise.resolve();
  session.orchestratorTools.send = () => Promise.resolve("confirmed");
  session.orchestratorTools.atPrompt = () => Promise.resolve(true);
  session.orchestratorTools.stopWait = { totalMs: 50, pollMs: 5 };
  const { settled } = await session.stopOrchestrator(
    store.getBoard(SBX) as Board,
    o.id,
  );
  await settled;
  await store.setBoardOrchestrators(
    SBX,
    records().map((r) => (r.id === o.id ? { ...r, state: "running" } : r)),
  );
  drive(o, IDLE, T0 + 2_000);
  await settle();
  assert.equal(sent.length, 0);
});

void test("the timer fires once after wakeMinutes of quiet and not again while its reason waits", async () => {
  reset();
  await policy(15);
  const o = await addOrch("m-timer", "main");
  drive(o, IDLE, T0 + 14 * MIN);
  await settle();
  assert.equal(sent.length, 0, "not due yet");
  drive(o, BUSY, T0 + 16 * MIN);
  drive(o, BUSY, T0 + 17 * MIN);
  drive(o, BUSY, T0 + 18 * MIN);
  await settle();
  assert.equal(sent.length, 0);
  drive(o, IDLE, T0 + 19 * MIN);
  await settle(() => sent.length > 0);
  assert.deepEqual(
    sent.map((s) => s.text),
    [lineOf("timer 15 min")],
  );
  drive(o, IDLE, T0 + 20 * MIN);
  drive(o, IDLE, T0 + 33 * MIN);
  await settle();
  assert.equal(sent.length, 1, "a confirmed wake restarts the quiet time");
  drive(o, IDLE, T0 + 35 * MIN);
  await settle(() => sent.length > 1);
  assert.equal(sent[1]?.text, lineOf("timer 15 min"));
});

void test("a tool call of the orchestrator counts as activity for the timer", async () => {
  reset();
  await policy(15);
  const o = await addOrch("m-tool", "main");
  store.appendOrchestrationEvent({
    boardKey: SBX,
    cardId: null,
    sessionId: null,
    kind: "tool_call",
    data: { orchestratorId: o.id, tool: "list_cards" },
    ts: new Date(T0 + 30 * MIN).toISOString(),
  });
  drive(o, IDLE, T0 + 40 * MIN);
  await settle();
  assert.equal(sent.length, 0);
  drive(o, IDLE, T0 + 46 * MIN);
  await settle(() => sent.length > 0);
  assert.equal(sent[0]?.text, lineOf("timer 15 min"));
});

void test("wakeMinutes 0 never fires", async () => {
  reset();
  await policy(0);
  const o = await addOrch("m-off", "main");
  drive(o, IDLE, T0 + 1000 * MIN);
  await settle();
  assert.equal(sent.length, 0);
});

void test("an unconfirmed send keeps the reasons, writes an unconfirmed row and sets no lastWake", async () => {
  reset();
  await policy(0);
  const o = await addOrch("m-unconfirmed", "main");
  outcome = "unconfirmed";
  answer(o, "keep");
  drive(o, IDLE, T0);
  await settle(() => rows(o).length > 0);
  assert.equal(rows(o)[0]?.data.result, "unconfirmed");
  assert.equal(recordOf(o.id).lastWake ?? null, null);
  outcome = "confirmed";
  drive(o, IDLE, T0 + 10_000);
  await settle();
  assert.equal(sent.length, 1, "the 20 s limit counts an unconfirmed line");
  drive(o, IDLE, T0 + 20_000);
  await settle(() => sent.length > 1);
  assert.equal(sent[1]?.text, lineOf("decision keep answered"));
  assert.equal(rows(o).at(-1)?.data.result, "confirmed");
  assert.deepEqual(recordOf(o.id).lastWake?.reasons, [
    "decision keep answered",
  ]);
});

void test("no second line starts while a send is in flight", async () => {
  reset();
  const o = await addOrch("m-flight", "main");
  let release = () => {};
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  answer(o, "one");
  drive(o, IDLE, T0);
  answer(o, "two");
  drive(o, IDLE, T0 + 60_000);
  await settle();
  assert.equal(sent.length, 1);
  release();
  await settle();
  drive(o, IDLE, T0 + 120_000);
  await settle(() => sent.length > 1);
  assert.equal(sent[1]?.text, lineOf("decision two answered"));
});

void test("a group event wakes only the extra that holds the group, and a decision answer only the one it names", async () => {
  reset();
  const a = await store.createLocalCard(SBX, "member a", "");
  const b = await store.createLocalCard(SBX, "member b", "");
  const group = await store.createGroupCard(SBX, "scoped", [a.id, b.id]);
  assert.ok(group.ok);
  const loose = await store.createLocalCard(SBX, "loose", "");
  const main = await addOrch("m-owner", "main");
  const extra = await addOrch("x-owner", "extra", [group.card.id]);
  store.appendOrchestrationEvent({
    boardKey: SBX,
    cardId: group.card.id,
    sessionId: null,
    kind: "group_state",
    data: { state: "needs_input", reason: "done" },
    ts: new Date().toISOString(),
  });
  drive(main, IDLE, T0);
  await settle();
  assert.equal(sent.length, 0, "the main does not get its extra's group");
  drive(extra, IDLE, T0);
  await settle(() => sent.length > 0);
  assert.deepEqual(
    sent.map((s) => [s.id, s.text]),
    [[extra.id, lineOf(`${group.card.identifier} needs_input`)]],
  );
  store.appendOrchestrationEvent({
    boardKey: SBX,
    cardId: loose.id,
    sessionId: null,
    kind: "group_state",
    data: { state: "agent_done", reason: "x" },
    ts: new Date().toISOString(),
  });
  answer(main, "for-extra", extra.id);
  drive(main, IDLE, T0 + 60_000);
  await settle();
  assert.equal(
    sent.length,
    1,
    "a ticket card is no group and the answer is not the main's",
  );
});

void test(
  "a supervisor sample of a real orchestrator pane types the wake line and the transcript confirms it",
  { skip: !hasTmux },
  async () => {
    reset();
    await policy(0);
    const s = await startSupervised({
      tmpRoot: env.root,
      title: "orch-live",
      orchestrator: "live",
      scenario: { logAllKeys: true },
    });
    const prior = SEND_TIMING.settleMs;
    const priorConfirm = SEND_TIMING.confirmMs;
    Object.assign(SEND_TIMING, { settleMs: 200, confirmMs: 4_000 });
    wake.wakeTools.send = (await import("./supervisor-send.js")).sendConfirmed;
    try {
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
      await sample();
      store.appendOrchestrationEvent({
        boardKey: SBX,
        cardId: null,
        sessionId: null,
        kind: "decision_answered",
        data: { decisionId: "live-1", orchestratorId: "live" },
        ts: new Date().toISOString(),
      });
      await sample();
      const end = Date.now() + 8_000;
      while (s.userTexts().length === 0 && Date.now() < end)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(s.userTexts(), [lineOf("decision live-1 answered")]);
      await settle(
        () =>
          (store.getBoard(SBX)?.orchestrators[0]?.lastWake ?? null) !== null,
      );
      assert.deepEqual(
        store.getBoard(SBX)?.orchestrators[0]?.lastWake?.reasons,
        ["decision live-1 answered"],
      );
    } finally {
      Object.assign(SEND_TIMING, { settleMs: prior, confirmMs: priorConfirm });
    }
  },
);
