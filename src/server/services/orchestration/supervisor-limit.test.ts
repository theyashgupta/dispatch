import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import type {
  BucketedCandidate,
  ChainCandidate,
} from "../domain/account-selection.js";
import type { LimitDeps } from "./supervisor-limit.js";
import type { SessionMoveOutcome } from "./session-account-move.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { CREDITS_OPTION } = await import("../domain/limit-surface.js");
const { answerLimit, escapeLimit, moveOrWait } =
  await import("./supervisor-limit.js");
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

const acct = (
  id: string,
  percent: number,
  state: ChainCandidate["state"] = "available",
): BucketedCandidate => ({
  id,
  state,
  limitedUntil: null,
  buckets: [{ kind: "weekly_all", percent, resetsAt: null }],
});

interface FakeOpts {
  candidates?: BucketedCandidate[];
  outcomes?: (SessionMoveOutcome | "throw")[];
  ready?: false;
  send?: LimitDeps["send"];
  onMove?: () => void;
  leftLimit?: true;
}

function fakeDeps(usageReset: number | null = null, opts: FakeOpts = {}) {
  const timers: { run: () => void; ms: number }[] = [];
  const moves: { accountId: string; sessionId?: string; cause?: string }[] = [];
  const redraws: { target: string; keys: string[] }[] = [];
  const clock = { at: NOW };
  const outcomes = opts.outcomes ?? ["moved"];
  const deps: LimitDeps = {
    now: () => clock.at,
    schedule: (run: () => void, ms: number) => {
      timers.push({ run, ms });
    },
    usageResetAt: () => usageReset,
    cursorWaitMs: 2_000,
    candidates: () => Promise.resolve(opts.candidates ?? []),
    move: (_cardId, accountId, sessionId, cause, seen) => {
      const outcome = outcomes[Math.min(moves.length, outcomes.length - 1)];
      moves.push({ accountId, sessionId, cause });
      opts.onMove?.();
      if (outcome === "throw") return Promise.reject(new Error("tmux failed"));
      if (outcome === "moved" && opts.ready === false && seen)
        seen.ready = false;
      if (opts.leftLimit && seen) seen.leftLimit = true;
      return Promise.resolve(outcome);
    },
    sendKeys: (target, keys) => {
      redraws.push({ target, keys });
      return Promise.resolve();
    },
    redrawMs: 10,
    ...(opts.send ? { send: opts.send } : {}),
  };
  return { timers, moves, redraws, clock, deps };
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
    await escapeLimit(s.card(), s.session(), "", deps);
    await escapeLimit(s.card(), s.session(), "", deps);
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
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
    });
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
    assert.equal(moves.length, 0);
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

const LIMIT_PANE =
  "You've hit your weekly limit · resets Oct 7 at 8:30am (Asia/Calcutta)";
const RESET_MS = new Date(2026, 9, 7, 8, 32).getTime() - NOW;
const confirmed: LimitDeps["send"] = () => Promise.resolve("confirmed");
const NOT_READY = { warmingUpMs: 600_000 };

const limitEvent = (s: Started) =>
  s.actions().find((e) => e.data.action === "limit_move");
const waitEvent = (s: Started) =>
  s.actions().find((e) => e.data.action === "limit_wait");

void test(
  "a limit stop moves to the account with headroom, clears the queued move and sends the continue text",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-move", {});
    await store.setPendingAccount(s.card().id, s.session().id, "acct-b");
    let pendingAtMove: string | undefined = "unset";
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-a", 40), acct("acct-b", 13)],
      onMove: () => {
        pendingAtMove = s.session().pendingClaudeAccountId;
      },
    });
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(pendingAtMove, undefined);
    assert.deepEqual(moves, [
      { accountId: "acct-b", sessionId: s.session().id, cause: "usage limit" },
    ]);
    assert.equal(s.userTexts().length, 1);
    assert.ok(s.userTexts()[0].startsWith("The usage limit has reset."));
    assert.equal(s.session().pendingClaudeAccountId, undefined);
    assert.equal(timers.length, 0);
    const event = limitEvent(s);
    assert.equal(event?.data.from, "default");
    assert.equal(event?.data.to, "acct-b");
    assert.equal(event?.data.result, "moved");
    assert.equal(event?.data.continue, "confirmed");
    assert.equal(waitEvent(s), undefined);
  },
);

void test(
  "a limit stop with no account under the headroom line waits to the printed reset and says why",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-no-headroom", {});
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [
        acct("acct-a", 90),
        acct("acct-b", 13, "limited"),
        acct("acct-c", 13, "unknown"),
        acct("acct-d", 13, "login-expired"),
        acct("default", 5),
      ],
    });
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(moves.length, 0);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, RESET_MS);
    assert.equal(waitEvent(s)?.data.reason, "no_headroom");
    assert.equal(waitEvent(s)?.data.source, "pane");
    assert.equal(limitEvent(s), undefined);
    assert.deepEqual(s.userTexts(), []);
  },
);

void test(
  "a pinned session never moves and waits for the reset",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-pinned", {});
    await store.setAccountPinned(s.card().id, s.session().id, true);
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
    });
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(moves.length, 0);
    assert.equal(timers.length, 1);
    assert.equal(waitEvent(s)?.data.reason, "pinned");
  },
);

void test(
  "a second limit within 30 minutes waits, and one after 30 minutes moves again",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-recent", {});
    const { timers, moves, clock, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      send: confirmed,
    });
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(moves.length, 1);
    clock.at = NOW + 29 * 60_000;
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(moves.length, 1);
    assert.equal(timers.length, 1);
    assert.equal(waitEvent(s)?.data.reason, "recent_move");
    clock.at = NOW + 31 * 60_000;
    timers[0].run();
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(moves.length, 2);
  },
);

void test(
  "a busy refusal gets exactly one C-l redraw and then moves on the retry",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-redraw", NOT_READY);
    const { timers, moves, redraws, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["busy", "moved"],
      send: confirmed,
    });
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(moves.length, 2);
    assert.deepEqual(redraws, [
      { target: `=${s.session().tmuxSession}:`, keys: ["C-l"] },
    ]);
    assert.equal(timers.length, 0);
    assert.equal(limitEvent(s)?.data.result, "moved");
  },
);

void test(
  "a move that stays busy after one redraw waits for the reset with the outcome as the reason",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-busy", NOT_READY);
    const { timers, moves, redraws, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["busy"],
      send: confirmed,
    });
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(moves.length, 2);
    assert.equal(redraws.length, 1);
    assert.equal(timers.length, 1);
    assert.equal(limitEvent(s)?.data.result, "busy");
    assert.equal(waitEvent(s)?.data.reason, "busy");
  },
);

void test(
  "a stale session whose move does not settle keeps its account and stale flag",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-stale-busy", NOT_READY);
    await store.markAccountStale(s.card().id, s.session().id);
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["busy", "busy"],
      send: confirmed,
    });
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(moves.length, 2);
    assert.equal(s.session().claudeAccountId, undefined);
    assert.equal(s.session().claudeAccountStale, true);
    assert.equal(timers.length, 1);
    assert.equal(waitEvent(s)?.data.reason, "busy");
  },
);

void test(
  "a move that is refused or throws waits for the reset and sends no prompt",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const cases: [string, FakeOpts, string][] = [
      ["refused", { outcomes: ["legacy"] }, "legacy"],
      ["throws", { outcomes: ["throw"] }, "error"],
    ];
    for (const [name, opts, reason] of cases) {
      const s = await start(`limit-outcome-${reason}`, {});
      const sent: string[] = [];
      const { timers, deps } = fakeDeps(null, {
        candidates: [acct("acct-b", 13)],
        send: (_card, _session, text) => {
          sent.push(text);
          return Promise.resolve("confirmed");
        },
        ...opts,
      });
      await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
      assert.equal(timers.length, 1, name);
      assert.equal(limitEvent(s)?.data.result, reason, name);
      assert.equal(waitEvent(s)?.data.reason, reason, name);
      assert.deepEqual(sent, [], name);
    }
  },
);

void test(
  "a reset timer sends nothing once the session moved to another account, and sends when it did not",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    setSupervisor("on");
    const stayed = await start("limit-timer-same", {});
    const first = fakeDeps();
    await moveOrWait(stayed.card(), stayed.session(), LIMIT_PANE, first.deps);
    assert.equal(waitEvent(stayed)?.data.reason, "no_headroom");
    first.timers[0].run();
    const until = Date.now() + 15_000;
    while (stayed.userTexts().length === 0 && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(stayed.userTexts().length, 1);

    const moved = await start("limit-timer-moved", {});
    const second = fakeDeps();
    await moveOrWait(moved.card(), moved.session(), LIMIT_PANE, second.deps);
    assert.equal(second.timers.length, 1);
    await store.setSessionAccount(
      moved.card().id,
      moved.session().id,
      "acct-b",
    );
    second.timers[0].run();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.deepEqual(moved.userTexts(), []);
    assert.ok(!moved.actions().some((e) => e.data.action === "continue"));
  },
);

void test(
  "the limit menu under wait with headroom presses Enter on the stop row only, then moves the session",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-menu-move", limitMenu(1));
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      send: confirmed,
    });
    await answerLimit(s.card(), s.session(), deps);
    const keys = await s.keysSettled(2);
    assert.deepEqual(
      keys.map((k) => k.key),
      ["up", "enter"],
    );
    assert.equal(keys.at(-1)?.row, STOP);
    await assertNoCreditsEnter(s);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].accountId, "acct-b");
    assert.equal(timers.length, 0);
    assert.equal(limitEvent(s)?.data.to, "acct-b");
  },
);

void test(
  "the limit menu under stop never moves",
  { skip: !hasTmux },
  async () => {
    setPolicy("stop");
    const s = await start("limit-menu-stop-nomove", limitMenu(0));
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
    });
    await answerLimit(s.card(), s.session(), deps);
    await assertNoCreditsEnter(s);
    assert.equal(moves.length, 0);
    assert.equal(timers.length, 0);
    assert.equal(s.session().stateReason, "usage_stop");
    setPolicy("wait");
  },
);

void test(
  "a credits row under the cursor gets no Enter and no move",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-move-credits", limitMenu(1, undefined, 2));
    const { moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
    });
    await answerLimit(s.card(), s.session(), deps);
    await assertNoCreditsEnter(s);
    assert.equal(moves.length, 0);
    assert.equal(s.session().state, "needs_input");
  },
);

void test(
  "a move that answers same continues like a moved one",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-same", {});
    const sent: string[] = [];
    const { timers, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["same"],
      send: (_card, _session, text) => {
        sent.push(text);
        return Promise.resolve("confirmed");
      },
    });
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(sent.length, 1);
    assert.equal(timers.length, 0);
    assert.equal(limitEvent(s)?.data.result, "same");
    assert.equal(limitEvent(s)?.data.continue, "confirmed");
    assert.notEqual(s.session().stateReason, "supervisor_gave_up");
  },
);

void test(
  "a settled move whose continue is not confirmed ends at needs_input and does not wait for the old reset",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const cases: [string, FakeOpts, string, boolean][] = [
      [
        "claude not ready",
        { ready: false, send: confirmed },
        "not_ready",
        false,
      ],
      [
        "the continue is unconfirmed",
        { send: () => Promise.resolve("unconfirmed") },
        "moved",
        true,
      ],
      [
        "the continue throws",
        { send: () => Promise.reject(new Error("boom")) },
        "error",
        true,
      ],
    ];
    for (const [index, [name, opts, result, sends]] of cases.entries()) {
      const s = await start(`limit-gave-up-${index}`, {});
      let calls = 0;
      const send = opts.send!;
      const { timers, deps } = fakeDeps(null, {
        candidates: [acct("acct-b", 13)],
        ...opts,
        send: (...args) => {
          calls += 1;
          return send(...args);
        },
      });
      await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
      assert.equal(timers.length, 0, name);
      assert.equal(waitEvent(s), undefined, name);
      assert.equal(limitEvent(s)?.data.result, result, name);
      assert.equal(calls, sends ? 1 : 0, name);
      assert.equal(s.session().state, "needs_input", name);
      assert.equal(s.session().stateReason, "supervisor_gave_up", name);
      assert.ok(
        s
          .actions()
          .some(
            (e) =>
              e.data.action === "needs_input" &&
              e.data.evidence ===
                "limit: moved to acct-b, continue not confirmed",
          ),
        name,
      );
    }
  },
);

void test(
  "a busy refusal sends no C-l when the card is paused or the pane is ready, and waits with the busy reason",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const ready = await start("limit-busy-ready", {});
    const first = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["busy"],
    });
    await moveOrWait(ready.card(), ready.session(), LIMIT_PANE, first.deps);
    assert.equal(first.moves.length, 1);
    assert.deepEqual(first.redraws, []);
    assert.equal(first.timers.length, 1);
    assert.equal(waitEvent(ready)?.data.reason, "busy");

    const paused = await start("limit-busy-paused", NOT_READY);
    const second = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["busy"],
    });
    const card = {
      ...paused.card(),
      paused: {
        at: "2026-10-06T00:00:00.000Z",
        by: "user" as const,
        sessionId: paused.session().id,
        pids: [],
      },
    };
    await moveOrWait(card, paused.session(), LIMIT_PANE, second.deps);
    assert.equal(second.moves.length, 1);
    assert.deepEqual(second.redraws, []);
    assert.equal(second.timers.length, 1);
    assert.equal(waitEvent(paused)?.data.reason, "busy");
  },
);

void test(
  "a pane on the auto continue surface records the wait reason with auto_continue and schedules nothing",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-auto-continue", {});
    const { timers, moves, deps } = fakeDeps();
    await moveOrWait(
      s.card(),
      s.session(),
      "  Continuing automatically at 11:40pm · esc to cancel",
      deps,
    );
    assert.equal(moves.length, 0);
    assert.equal(timers.length, 0);
    assert.equal(waitEvent(s)?.data.reason, "no_headroom");
    assert.equal(waitEvent(s)?.data.auto_continue, true);
  },
);

void test(
  "an auto continue pane whose move pressed Escape and came back busy still schedules the reset wait",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-auto-continue-left", {});
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["busy"],
      leftLimit: true,
    });
    await moveOrWait(
      s.card(),
      s.session(),
      "  Continuing automatically at 11:40pm · esc to cancel",
      deps,
    );
    assert.equal(moves.length, 1);
    assert.equal(timers.length, 1);
    assert.equal(waitEvent(s)?.data.reason, "busy");
    assert.equal(waitEvent(s)?.data.auto_continue, undefined);
  },
);

void test(
  "an auto continue pane whose move came back busy without leaving the limit schedules nothing",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-auto-continue-kept", {});
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["busy"],
    });
    await moveOrWait(
      s.card(),
      s.session(),
      "  Continuing automatically at 11:40pm · esc to cancel",
      deps,
    );
    assert.equal(moves.length, 1);
    assert.equal(timers.length, 0);
    assert.equal(waitEvent(s)?.data.reason, "busy");
    assert.equal(waitEvent(s)?.data.auto_continue, true);
  },
);

void test(
  "a redraw that throws because the pane is gone skips the retry and waits with the busy reason",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-redraw-throws", NOT_READY);
    const { timers, moves, deps } = fakeDeps(null, {
      candidates: [acct("acct-b", 13)],
      outcomes: ["busy"],
    });
    let attempts = 0;
    deps.sendKeys = () => {
      attempts += 1;
      return Promise.reject(new Error("no such pane"));
    };
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(attempts, 1);
    assert.equal(moves.length, 1);
    assert.equal(timers.length, 1);
    assert.equal(waitEvent(s)?.data.reason, "busy");
  },
);

void test(
  "a wait keeps one timer per account, so a session that moved accounts waits again",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-timer-per-account", {});
    const { timers, deps } = fakeDeps();
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(timers.length, 1);
    await store.setSessionAccount(s.card().id, s.session().id, "acct-b");
    await moveOrWait(s.card(), s.session(), LIMIT_PANE, deps);
    assert.equal(timers.length, 2);
  },
);

void test(
  "a fresh start timer runs after the session moved accounts",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    setSupervisor("on");
    const s = await start("limit-fresh-account", limitMenu(0));
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
    const started: string[] = [];
    deps.fresh = (_card, session) => {
      started.push(session.id);
      return Promise.resolve(true);
    };
    await answerLimit(s.card(), s.session(), deps);
    assert.equal(timers.length, 1);
    await store.setSessionAccount(s.card().id, s.session().id, "acct-b");
    timers[0].run();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(started, [s.session().id]);
  },
);

void test(
  "a pane with no limit surface still schedules the fresh start once, reading the reset from the evidence",
  { skip: !hasTmux },
  async () => {
    const s = await start("limit-escape-no-surface", {});
    const { timers, deps } = fakeDeps();
    const evidence =
      "transcript: You've hit your weekly limit · resets Oct 7 at 8:30am (Asia/Calcutta)";
    await escapeLimit(s.card(), s.session(), evidence, deps);
    await escapeLimit(s.card(), s.session(), evidence, deps);
    assert.deepEqual(await s.keysSettled(1), []);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, RESET_MS);
    assert.equal(waitEvent(s)?.data.mode, "fresh");
    assert.equal(waitEvent(s)?.data.source, "transcript");
  },
);

void test(
  "a reset time found in the pane text records the pane as its source even beside transcript evidence",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const s = await start("limit-source-pane", {});
    const { deps } = fakeDeps();
    await moveOrWait(
      s.card(),
      s.session(),
      `transcript: You've hit your weekly limit\n${LIMIT_PANE}`,
      deps,
    );
    assert.equal(waitEvent(s)?.data.source, "pane");
  },
);

void test(
  "a dated reset text 8 hours in the past never schedules a continue at once",
  { skip: !hasTmux },
  async () => {
    setPolicy("wait");
    const past =
      "You've hit your weekly limit · resets Oct 6 at 2:00pm (Asia/Calcutta)";
    const GRACE = 2 * 60_000;
    const future = NOW + 90 * 60_000;
    const withUsage = await start("limit-past-usage", {});
    const first = fakeDeps(future);
    await moveOrWait(withUsage.card(), withUsage.session(), past, first.deps);
    assert.equal(first.timers.length, 1);
    assert.equal(first.timers[0].ms, future + GRACE - NOW);
    assert.equal(waitEvent(withUsage)?.data.source, "usage");

    const stale = await start("limit-past-stale-usage", {});
    const second = fakeDeps(NOW - 60_000);
    await moveOrWait(stale.card(), stale.session(), past, second.deps);
    assert.equal(second.timers[0].ms, 5 * 60 * 60_000 + GRACE);
    assert.equal(waitEvent(stale)?.data.source, "fallback");

    const none = await start("limit-past-no-usage", {});
    const third = fakeDeps(null);
    await moveOrWait(none.card(), none.session(), past, third.deps);
    assert.equal(third.timers[0].ms, 5 * 60 * 60_000 + GRACE);
    assert.equal(waitEvent(none)?.data.source, "fallback");
  },
);
