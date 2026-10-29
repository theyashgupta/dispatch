import test, { after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { sendConfirmed } from "./supervisor-send.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { actionTools, runActions, runPlanned } =
  await import("./supervisor-actions.js");
const { initialPlanMemory, planActions } =
  await import("../domain/supervisor-plan.js");
const { SBX, setupSupervisedBoard } =
  await import("../../test-support/supervised-session.js");

await setupSupervisedBoard();
after(() => env.cleanup());

const IDLE = readFileSync(
  new URL("../../test-support/fixtures/panes/idle.txt", import.meta.url),
  "utf8",
);
const HELD =
  "Read the resume file, then continue the loop from the lowest phase";
const EMPTY_PANE = IDLE;
const HELD_PANE = IDLE.replace(/❯[^\n]*\n/, `❯ ${HELD}\n`);

async function startedCard(title: string) {
  const created = await store.createLocalCard(SBX, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: path.join(env.root, title),
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  const card = () => store.getCard(created.id)!;
  const session = () =>
    card().sessions!.find((s) => s.id === card().activeSessionId)!;
  return { card, session };
}

const rows = (cardId: string, kind: string) =>
  store
    .listOrchestrationEvents(SBX, 0, 500)
    .filter((e) => e.cardId === cardId && e.kind === kind);

function fakeSend(result: "confirmed" | "unconfirmed") {
  const sent: string[] = [];
  const send = ((_card: unknown, _session: unknown, text: string) => {
    sent.push(text);
    return Promise.resolve(result);
  }) as unknown as typeof sendConfirmed;
  return { sent, send };
}

const CONTINUE = [{ kind: "continue", duty: "sleep_cut" }] as const;

void test("the supervisor does not type a second continue line while one is unsent", async () => {
  const { card, session } = await startedCard("unsent-held");
  const { sent, send } = fakeSend("confirmed");
  const ok = await runActions(card(), session(), [...CONTINUE], "idle", {
    ...actionTools,
    send,
    capture: () => Promise.resolve(HELD_PANE),
    userTexts: () => Promise.resolve(["something else"]),
  });
  assert.equal(ok, false);
  assert.equal(sent.length, 0);
  const actions = rows(card().id, "supervisor_action").filter(
    (e) => e.data.action === "continue",
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].data.result, "skipped");
  assert.equal(actions[0].data.reason, "previous line unsent");
  assert.equal(session().state, "needs_input");
  assert.equal(session().stateReason, "supervisor_gave_up");
});

void test("the restart and api_error continue lines are not typed while a line is unsent", async () => {
  for (const duty of ["restart", "api_error"] as const) {
    const { card, session } = await startedCard(`unsent-${duty}`);
    const { sent, send } = fakeSend("confirmed");
    const ok = await runActions(
      card(),
      session(),
      [{ kind: "continue", duty }],
      "idle",
      {
        ...actionTools,
        send,
        capture: () => Promise.resolve(HELD_PANE),
        userTexts: () => Promise.resolve([]),
      },
    );
    assert.equal(ok, false);
    assert.equal(sent.length, 0);
    assert.equal(session().stateReason, "supervisor_gave_up");
  }
});

void test("a box text the transcript shows does not block the continue line", async () => {
  const { card, session } = await startedCard("unsent-shown");
  const { sent, send } = fakeSend("confirmed");
  const ok = await runActions(card(), session(), [...CONTINUE], "idle", {
    ...actionTools,
    send,
    capture: () => Promise.resolve(HELD_PANE),
    userTexts: () => Promise.resolve([`  ${HELD.replace(/ /g, "\n")}  `]),
  });
  assert.equal(ok, true);
  assert.equal(sent.length, 1);
});

void test("an unconfirmed sleep cut line leaves the slot unspent and a confirmed one spends it", async () => {
  const { card, session } = await startedCard("unsent-slot");
  const wokeAt = 1_000_000;
  const plan = (now: number, memory: ReturnType<typeof initialPlanMemory>) =>
    planActions({
      from: "working",
      to: "idle",
      loop: { engineActive: true, handoffPending: false, unitPhase: "1/3" },
      usageLimit: "wait",
      wokeAt,
      now,
      memory,
    });
  const sends: string[][] = [];
  const deps = (result: "confirmed" | "unconfirmed") => {
    const fake = fakeSend(result);
    sends.push(fake.sent);
    return {
      ...actionTools,
      send: fake.send,
      capture: () => Promise.resolve(EMPTY_PANE),
      userTexts: () => Promise.resolve([]),
    };
  };
  const before = initialPlanMemory();
  const first = plan(wokeAt + 60_000, before);
  assert.deepEqual(first.actions, [...CONTINUE]);
  const kept = await runPlanned(
    card(),
    session(),
    first,
    before,
    "idle",
    deps("unconfirmed"),
  );
  assert.deepEqual(kept, before);
  const second = plan(wokeAt + 90_000, kept);
  assert.deepEqual(second.actions, [...CONTINUE]);
  const spent = await runPlanned(
    card(),
    session(),
    second,
    kept,
    "idle",
    deps("confirmed"),
  );
  assert.deepEqual(spent, second.memory);
  assert.deepEqual(
    sends.map((s) => s.length),
    [1, 1],
  );
  assert.deepEqual(plan(wokeAt + 100_000, spent).actions, [
    { kind: "needs_input", reason: "supervisor_gave_up" },
  ]);
});
