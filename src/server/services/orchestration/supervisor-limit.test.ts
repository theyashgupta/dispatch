import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { CREDITS_OPTION } = await import("../domain/limit-surface.js");
const { answerLimit, escapeLimit } = await import("./supervisor-limit.js");
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

const STOP = "1. Stop and wait for limit to reset";
const WAIT = "2. Wait here, then continue automatically at 8:30am";
const CREDITS = "3. Switch to usage credits";
const NOW = new Date(2026, 9, 6, 22, 0).getTime();

function limitMenu(
  cursor: number,
  rows = [STOP, WAIT, CREDITS],
  jumpTo?: number,
) {
  return {
    prompt: "",
    transcript: ["❯ /rate-limit-options"],
    dialog: {
      title: "What do you want to do?",
      rows,
      cursor,
      ...(jumpTo === undefined ? {} : { jumpTo }),
    },
  };
}

function fakeDeps(usageReset: number | null = null) {
  const timers: { run: () => void; ms: number }[] = [];
  return {
    timers,
    deps: {
      now: () => NOW,
      schedule: (run: () => void, ms: number) => {
        timers.push({ run, ms });
      },
      usageResetAt: () => usageReset,
      cursorWaitMs: 2_000,
    },
  };
}

type Started = Awaited<ReturnType<typeof startSupervised>>;

/** S-17: no Enter in the key log ever had a credits row under the cursor. */
async function assertNoCreditsEnter(s: Started): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const key of s.keys()) {
    if (key.key === "enter")
      assert.doesNotMatch(String(key.row), CREDITS_OPTION);
  }
}

function setPolicy(usageLimit: "wait" | "stop"): void {
  store.getBoard(SBX)!.policy.usageLimit = usageLimit;
}

function setSupervisor(supervisor: "on" | "off"): void {
  store.getBoard(SBX)!.policy.supervisor = supervisor;
}

const start = (title: string, scenario: Record<string, unknown>) =>
  startSupervised({
    tmpRoot: env.root,
    title,
    scenario: { logAllKeys: true, ...scenario },
  });

for (const [cursor, moves] of [
  [0, []],
  [1, ["up"]],
  [2, ["up", "up"]],
] as const) {
  void test(
    `wait with the cursor on row ${cursor + 1} selects the stop row and schedules one continue`,
    { skip: !hasTmux },
    async () => {
      setPolicy("wait");
      const s = await start(`limit-wait-${cursor}`, limitMenu(cursor));
      const { timers, deps } = fakeDeps();
      await answerLimit(s.card(), s.session(), deps);
      const keys = await s.keysSettled(moves.length + 1);
      assert.deepEqual(
        keys.map((k) => k.key),
        [...moves, "enter"],
      );
      assert.equal(keys.at(-1)?.row, STOP);
      await assertNoCreditsEnter(s);
      assert.equal(timers.length, 1);
      const wait = s.actions().find((e) => e.data.action === "limit_wait");
      assert.equal(wait?.data.source, "pane");
      assert.equal(timers[0].ms, new Date(2026, 9, 7, 8, 32).getTime() - NOW);
      if (cursor === 0) {
        await s.setScenario({ prompt: "❯ ", dialog: null });
        timers[0].run();
        const until = Date.now() + 15_000;
        while (s.userTexts().length === 0 && Date.now() < until)
          await new Promise((resolve) => setTimeout(resolve, 200));
        assert.deepEqual(s.userTexts().length, 1);
        assert.ok(s.userTexts()[0].startsWith("The usage limit has reset."));
      }
      setPolicy("wait");
    },
  );
}

void test(
  "stop selects the stop row, sets usage_stop and schedules nothing",
  { skip: !hasTmux },
  async () => {
    setPolicy("stop");
    const s = await start("limit-stop", limitMenu(2));
    const { timers, deps } = fakeDeps();
    await answerLimit(s.card(), s.session(), deps);
    assert.equal((await s.keysSettled(3)).at(-1)?.row, STOP);
    await assertNoCreditsEnter(s);
    assert.equal(timers.length, 0);
    assert.equal(s.session().state, "needs_input");
    assert.equal(s.session().stateReason, "usage_stop");
    setPolicy("wait");
  },
);

void test(
  "a cursor that moves to credits before Enter is refused and no Enter is sent",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-jump", limitMenu(1, undefined, 2));
    const { timers, deps } = fakeDeps();
    await answerLimit(s.card(), s.session(), deps);
    const keys = await s.keysSettled(2);
    assert.deepEqual(
      keys.map((k) => k.key),
      ["up"],
    );
    assert.equal(keys[0].row, CREDITS);
    await assertNoCreditsEnter(s);
    assert.equal(timers.length, 0);
    assert.equal(s.session().state, "needs_input");
    assert.equal(
      s.actions().find((e) => e.data.action === "limit_answer")?.data.result,
      "refused",
    );
  },
);

void test(
  "a limit menu with only credits rows gets no key",
  { skip: !hasTmux },
  async () => {
    const s = await start(
      "limit-credits-only",
      limitMenu(0, [
        "1. Switch to usage credits until the limit to reset",
        "2. Upgrade your plan",
      ]),
    );
    const { timers, deps } = fakeDeps();
    await answerLimit(s.card(), s.session(), deps);
    assert.deepEqual(await s.keysSettled(1), []);
    assert.equal(timers.length, 0);
    assert.equal(s.session().state, "needs_input");
  },
);

void test(
  "without a pane time the reset comes from the usage poll, else five hours",
  { skip: !hasTmux },
  async () => {
    const rows = [STOP, "2. Wait here, then continue automatically"];
    const fromUsage = await start("limit-usage", limitMenu(0, rows));
    const usageReset = NOW + 90 * 60_000;
    const first = fakeDeps(usageReset);
    await answerLimit(fromUsage.card(), fromUsage.session(), first.deps);
    assert.equal(first.timers[0].ms, usageReset + 2 * 60_000 - NOW);
    await assertNoCreditsEnter(fromUsage);
    const fallback = await start("limit-fallback", limitMenu(0, rows));
    const second = fakeDeps(null);
    await answerLimit(fallback.card(), fallback.session(), second.deps);
    assert.equal(second.timers[0].ms, 5 * 60 * 60_000 + 2 * 60_000);
    assert.equal(
      fallback.actions().find((e) => e.data.action === "limit_wait")?.data
        .source,
      "fallback",
    );
    await assertNoCreditsEnter(fallback);
  },
);

void test(
  "wait with handoff-pending sends Escape once at the auto continue surface and plans a fresh session",
  { skip: !hasTmux },
  async () => {
    const s = await start("limit-escape", {
      prompt: "",
      transcript: [
        "  ⚠ Usage limit reached · limit resets 11:40pm · clau.de/wrap-up",
        "    Continuing automatically at 11:40pm · esc to cancel",
      ],
    });
    const { timers, deps } = fakeDeps();
    await escapeLimit(s.card(), s.session(), deps);
    await escapeLimit(s.card(), s.session(), deps);
    const keys = await s.keysSettled(2);
    assert.deepEqual(
      keys.map((k) => k.key),
      ["esc"],
    );
    await assertNoCreditsEnter(s);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, new Date(2026, 9, 6, 23, 42).getTime() - NOW);
    assert.equal(
      s.actions().find((e) => e.data.action === "limit_wait")?.data.mode,
      "fresh",
    );
  },
);

void test(
  "wait at the limit menu with the loop at handoff-pending schedules a fresh session",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-menu-fresh", limitMenu(0));
    await store.setLoopProgress(s.card().id, {
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
    const { timers, deps } = fakeDeps();
    await answerLimit(s.card(), s.session(), deps);
    assert.deepEqual(
      (await s.keysSettled(1)).map((k) => k.key),
      ["enter"],
    );
    await assertNoCreditsEnter(s);
    assert.equal(timers.length, 1);
    assert.equal(
      s.actions().find((e) => e.data.action === "limit_wait")?.data.mode,
      "fresh",
    );
  },
);

const TIMER_CASES: [string, (s: Started) => Promise<void>][] = [
  [
    "the board switched the supervisor off",
    () => Promise.resolve(setSupervisor("off")),
  ],
  [
    "the session got the usage_stop reason",
    async (s) => {
      await store.setSessionStateIfSession(
        s.card().id,
        s.session().id,
        "needs_input",
        "usage_stop",
      );
    },
  ],
  [
    "the board policy changed to stop",
    () => Promise.resolve(setPolicy("stop")),
  ],
];

for (const [index, [name, change]] of TIMER_CASES.entries()) {
  void test(
    `a reset timer sends nothing after ${name}`,
    { skip: !hasTmux },
    async () => {
      setSupervisor("on");
      setPolicy("wait");
      const s = await start(`limit-timer-${index}`, limitMenu(0));
      const { timers, deps } = fakeDeps();
      await answerLimit(s.card(), s.session(), deps);
      assert.equal(timers.length, 1);
      const sentKeys = (await s.keysSettled(1)).length;
      await change(s);
      await s.setScenario({ prompt: "❯ ", dialog: null });
      timers[0].run();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      assert.equal(s.keys().length, sentKeys);
      assert.deepEqual(s.userTexts(), []);
      assert.ok(!s.actions().some((e) => e.data.action === "continue"));
      await assertNoCreditsEnter(s);
      setSupervisor("on");
      setPolicy("wait");
    },
  );
}

void test(
  "a reset time far past the timer limit is capped at 2^31 - 1 ms",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const rows = [STOP, "2. Wait here, then continue automatically"];
    const s = await start("limit-cap", limitMenu(0, rows));
    const { timers, deps } = fakeDeps(NOW + 60 * 24 * 3_600_000);
    await answerLimit(s.card(), s.session(), deps);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 2 ** 31 - 1);
    assert.equal(timers[0].ms, 2147483647);
    assert.equal(
      s.actions().find((e) => e.data.action === "limit_wait")?.data.source,
      "usage",
    );
    await assertNoCreditsEnter(s);
  },
);

/** Put `groupId` in the scope of extra `extra-1` with `override`, beside a main. */
async function extraOwns(
  groupId: string,
  override: { usageLimit?: "wait" | "stop" },
): Promise<void> {
  const base = {
    cardId: null,
    state: "stopped" as const,
    createdAt: "2026-10-08T00:00:00.000Z",
  };
  await store.setBoardOrchestrators(SBX, [
    {
      ...base,
      id: "main",
      name: "Main",
      role: "main",
      scope: { groupIds: [], ticketIds: [] },
      policyOverride: {},
    },
    {
      ...base,
      id: "extra-1",
      name: "Extra 1",
      role: "extra",
      scope: { groupIds: [groupId], ticketIds: [] },
      policyOverride: override,
    },
  ]);
}

void test(
  "an extra-owned group with a stop override on a wait board stops at the limit, and without the override waits",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const stopped = await startSupervised({
      tmpRoot: env.root,
      title: "limit-extra-stop",
      scenario: { logAllKeys: true, ...limitMenu(0) },
      group: true,
    });
    await extraOwns(stopped.card().id, { usageLimit: "stop" });
    const stopRun = fakeDeps();
    await answerLimit(stopped.card(), stopped.session(), stopRun.deps);
    assert.equal((await stopped.keysSettled(1)).at(-1)?.row, STOP);
    assert.equal(stopRun.timers.length, 0);
    assert.equal(stopped.session().stateReason, "usage_stop");

    const waited = await startSupervised({
      tmpRoot: env.root,
      title: "limit-extra-wait",
      scenario: { logAllKeys: true, ...limitMenu(0) },
      group: true,
    });
    await extraOwns(waited.card().id, {});
    const waitRun = fakeDeps();
    await answerLimit(waited.card(), waited.session(), waitRun.deps);
    assert.equal((await waited.keysSettled(1)).at(-1)?.row, STOP);
    assert.equal(waitRun.timers.length, 1);
    assert.equal(waited.session().stateReason, undefined);
    await store.setBoardOrchestrators(SBX, []);
  },
);
