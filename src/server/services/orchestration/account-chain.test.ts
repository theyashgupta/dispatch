import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { SWITCH_NOW_REASON } from "../../../shared/account-chain.js";
import type {
  ClaudeAccountsSettings,
  ClaudeUsageSnapshot,
  ClaudeUsageWindow,
} from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import type { ChainEvent } from "./account-chain-records.js";
import {
  BUSY_PANE,
  IDLE_PANE,
  LIMIT_PANE,
  NO_STOP_LIMIT_PANE,
  installFakeTmux,
} from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

process.env.DISPATCH_USAGE_URL = "http://127.0.0.1:1/usage";
process.env.DISPATCH_LIMIT_CLEAR_MS = "600";
const env = isolateEnv();
const fake = installFakeTmux(env);

const { store } = await import("../../store/board.store.js");
const {
  upsertAccount,
  accountDir,
  getActiveAccountId,
  removeAccount,
  setActiveAccount,
  adoptManagedDefault,
  writeDefaultIdentity,
} = await import("./claude-accounts.js");
const { emptyChainState, readChainState, writeChainState } =
  await import("./account-chain-state.js");
const {
  chainTimers,
  forgetChainAccount,
  handleLimitSignal,
  handleUsageRead,
  noteHomeIdentity,
  requestFailover,
  startAccountChain,
  updateChainSettings,
  whenChainIdle,
} = await import("./account-chain.js");
const { continueAtLimit, sendContinuePrompt } =
  await import("./session-account-move.js");
const { moveOrQueue, runPendingMove, sweepPendingMoves } =
  await import("./session-account-apply.js");
const { liveTurnState, recordTurnEvent } = await import("./session-turn.js");
const { refreshUsage } = await import("./claude-usage.js");
const { closeAccountDecision, raiseExhaustedDecision, raiseLoginDecision } =
  await import("./account-decisions.js");
const { answerDecisionItem } = await import("./decision-items.js");
const {
  setHooksRuntime,
  setOrchestrationConfig,
  updateClaudeAccountsSettings,
} = await import("../infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "", port: 4700 });
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
for (const [id, day] of [
  [ACCOUNT_A, "01"],
  [ACCOUNT_B, "02"],
]) {
  await upsertAccount({
    id,
    email: `${id.slice(0, 4)}@example.com`,
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: `2026-10-${day}T00:00:00.000Z`,
    lastLoginAt: `2026-10-${day}T00:00:00.000Z`,
  });
  fs.mkdirSync(accountDir(id), { recursive: true });
}
const workspace = path.join(env.root, "ws");
fs.mkdirSync(workspace);
await store.load();

const BASE = Date.parse("2026-10-06T10:00:00.000Z");
const MIN = 60_000;
let clock = BASE;
let due: { at: number; run: () => void }[] = [];
const reads = new Map<string, ClaudeUsageSnapshot>();
const readLog: string[] = [];
const events: ChainEvent[] = [];
let readMode: "fresh" | "cached" | "throw" = "fresh";

const iso = (ms: number): string => new Date(ms).toISOString();

/** A good usage read with one session bucket at `percent` that resets at `resetsAt`. */
function usage(
  percent: number,
  resetsAt: string | null = iso(clock + 60 * MIN),
): ClaudeUsageSnapshot {
  return {
    status: "ok",
    fetchedAt: iso(clock),
    windows: [
      {
        kind: "session",
        label: "Session",
        percent,
        resetsAt,
        isActive: true,
        periodStart: null,
        periodEnd: null,
      },
    ],
  };
}

/** A surface (a) line that prints the local clock time of `ms`, as the CLI prints a reset. */
function surfaceAt(ms: number): string {
  const at = new Date(ms);
  const minutes = String(at.getMinutes()).padStart(2, "0");
  const half = at.getHours() < 12 ? "am" : "pm";
  return `Usage limit reached · continuing automatically at ${at.getHours() % 12 || 12}:${minutes}${half} · esc to cancel`;
}

const logins: (string | undefined)[] = [];
const raised: string[] = [];
const raisedExhausted: (string | null)[] = [];
const closed: { decisionId: string; optionId: string; note: string }[] = [];

const fakeDeps = {
  now: () => clock,
  setTimer: (run: () => void, ms: number) => {
    const timer = { at: clock + ms, run };
    due.push(timer);
    return timer;
  },
  clearTimer: (handle: unknown) => {
    due = due.filter((t) => t !== handle);
  },
  refreshUsage: (id: string) => {
    readLog.push(id);
    if (readMode === "throw") return Promise.reject(new Error("read failed"));
    const snap = reads.get(id) ?? usage(10);
    return Promise.resolve(
      readMode === "fresh" && snap.status === "ok"
        ? { ...snap, fetchedAt: iso(clock) }
        : snap,
    );
  },
  cachedUsage: (id: string) => reads.get(id) ?? usage(10),
  loggedIn: () => Promise.resolve(true),
  emit: (event: ChainEvent) => {
    events.push(event);
  },
  startLogin: (accountId?: string) => {
    logins.push(accountId);
    return Promise.resolve({ ok: true });
  },
  raiseLoginDecision: (accountId: string) => {
    raised.push(accountId);
    return Promise.resolve(
      raiseLoginDecision(accountId, `${accountId}@x.test`),
    );
  },
  raiseExhaustedDecision: (earliestResetAt: string | null) => {
    raisedExhausted.push(earliestResetAt);
    return Promise.resolve(raiseExhaustedDecision(earliestResetAt));
  },
  closeDecision: (decisionId: string, optionId: string, note: string) => {
    closed.push({ decisionId, optionId, note });
    closeAccountDecision(decisionId, optionId, note);
  },
  scanMs: 0,
};

/** Move the fake clock forward by `ms`, firing each due timer in order and waiting for its work. */
async function advance(ms: number): Promise<void> {
  const until = clock + ms;
  for (;;) {
    const next = due
      .filter((t) => t.at <= until)
      .sort((a, b) => a.at - b.at)[0];
    if (next === undefined) break;
    due = due.filter((t) => t !== next);
    clock = Math.max(clock, next.at);
    next.run();
    await whenChainIdle();
  }
  clock = until;
}

const made: { cardId: string; sessionId: string }[] = [];
let stop: () => void = () => undefined;

/** Reset the board, the clock, the chain file and the pointer, then start the controller. */
async function begin(
  settings: Partial<ClaudeAccountsSettings> = {},
  deps: Partial<typeof fakeDeps> = {},
  homeIdentity = { email: "", orgId: "" },
) {
  stop();
  await whenChainIdle();
  for (const m of made.splice(0)) {
    await store.markSessionLost(m.cardId, m.sessionId);
  }
  fake.reset();
  due = [];
  events.length = 0;
  readLog.length = 0;
  logins.length = 0;
  raised.length = 0;
  raisedExhausted.length = 0;
  closed.length = 0;
  reads.clear();
  readMode = "fresh";
  clock = BASE;
  await writeChainState(emptyChainState());
  await writeDefaultIdentity(homeIdentity);
  await setActiveAccount("default");
  updateClaudeAccountsSettings({
    autoMove: true,
    thresholdPercent: 100,
    minDwellMinutes: 15,
    hysteresisPercent: 0,
    ...settings,
  });
  stop = await startAccountChain({ ...fakeDeps, ...deps });
}

/** A card whose active session runs in tmux session `dsp-<title>` on `accountId`. */
async function sessionCard(
  title: string,
  pane?: string,
  accountId = "default",
) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: workspace,
    tmuxSession: `dsp-${title}`,
    branch: title,
    claudeAccountId: accountId,
  });
  const sessionId = store.getCard(created.id)!.activeSessionId!;
  if (pane !== undefined) {
    fs.writeFileSync(path.join(fake.state, `pane.dsp-${title}`), pane);
  }
  made.push({ cardId: created.id, sessionId });
  return { cardId: created.id, sessionId, title };
}

/** Script the pane a session shows after its next key send. */
function nextPane(title: string, pane: string): void {
  fs.writeFileSync(path.join(fake.state, `next.dsp-${title}.1`), pane);
}

/**
 * Put Claude back in the foreground of every fake pane.
 *
 * @remarks The fake shell stays at its prompt after a `/exit`, while a real move relaunches Claude.
 */
function claudeInForeground(): void {
  for (const f of fs.readdirSync(fake.state)) {
    if (f.startsWith("at-prompt.")) fs.rmSync(path.join(fake.state, f));
  }
}

const sessionOf = (ref: { cardId: string; sessionId: string }) =>
  store.getCard(ref.cardId)?.sessions?.find((s) => s.id === ref.sessionId);

/** Every tmux call sent to one session's pane, as tab-joined argument lines. */
function paneCalls(title: string): string[] {
  const log = path.join(fake.state, "calls.log");
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("send-keys") && l.includes(`=dsp-${title}:`));
}

const continued = (title: string): boolean =>
  paneCalls(title).some((l) => l.endsWith("\tContinue."));

void test.after(() => {
  stop();
  env.cleanup();
});

void test("trigger 1: a usage read at the threshold on the account in use moves an idle session down the chain and records the move (U2-07, U2-10)", async () => {
  await begin();
  const idle = await sessionCard("t1-idle");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(idle)?.claudeAccountId, ACCOUNT_A);
  assert.equal(continued("t1-idle"), false);
  assert.deepEqual(events, [
    {
      kind: "failover",
      from: "default",
      to: ACCOUNT_A,
      reason: "usage at the threshold",
      moved: true,
      sessions: 1,
    },
  ]);
  const saved = await readChainState();
  assert.equal(saved.inUseSince, iso(BASE));
  assert.deepEqual(saved.moves, [
    {
      at: iso(BASE),
      from: "default",
      to: ACCOUNT_A,
      reason: "usage at the threshold",
    },
  ]);
  assert.equal(saved.accounts.default?.state, "limited");
  assert.deepEqual(chainTimers(), [
    { key: "return:default", at: iso(BASE + 62 * MIN) },
  ]);
});

void test("a usage read at the threshold on an account not in use moves nothing", async () => {
  await begin();
  await sessionCard("t1-other");
  await handleUsageRead(ACCOUNT_A, usage(100));
  assert.equal(getActiveAccountId(), "default");
  assert.deepEqual(events, []);
});

void test("trigger 2: a limit surface on a session of the account in use moves it and sends Continue.", async () => {
  await begin();
  const limit = await sessionCard("t2-limit", surfaceAt(BASE + 60 * MIN));
  reads.set("default", usage(100));
  nextPane("t2-limit", IDLE_PANE);
  await liveTurnState(limit.cardId, limit.sessionId, "dsp-t2-limit");
  await whenChainIdle();
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(limit)?.claudeAccountId, ACCOUNT_A);
  assert.ok(paneCalls("t2-limit").some((l) => l.endsWith("\tEscape")));
  assert.equal(continued("t2-limit"), true);
  assert.equal(events[0]?.kind, "failover");
  assert.equal((events[0] as { reason: string }).reason, "limit surface");
});

void test("trigger 3 overrides the dwell: a rate limit StopFailure inside the dwell moves on again (U2-09)", async () => {
  await begin();
  const s = await sessionCard("t3-stop");
  await handleUsageRead("default", usage(100));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  await advance(2 * MIN);
  await handleUsageRead(ACCOUNT_A, usage(100));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  fs.writeFileSync(
    path.join(fake.state, "pane.dsp-t3-stop"),
    surfaceAt(clock + 60 * MIN),
  );
  nextPane("t3-stop", IDLE_PANE);
  claudeInForeground();
  recordTurnEvent(s.cardId, s.sessionId, "StopFailure", "rate_limit");
  await whenChainIdle();
  assert.equal(getActiveAccountId(), ACCOUNT_B);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_B);
  assert.equal(continued("t3-stop"), true);
  assert.equal((await readChainState()).moves.length, 2);
});

void test("dwell: usage at 99, 100, 99, 100 on four 2 minute polls gives one move (U2-09)", async () => {
  await begin();
  await sessionCard("dw-idle");
  for (const percent of [99, 100, 99, 100]) {
    await handleUsageRead(getActiveAccountId(), usage(percent));
    await advance(2 * MIN);
  }
  assert.equal((await readChainState()).moves.length, 1);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
});

void test("failover moves idle and limit sessions now, queues the busy one, skips the pinned one, and sends Continue. only to the limit one (U2-10, U2-15)", async () => {
  await begin();
  const idle = await sessionCard("fo-idle");
  const busy = await sessionCard("fo-busy", BUSY_PANE);
  const limit = await sessionCard("fo-limit", LIMIT_PANE);
  nextPane("fo-limit", IDLE_PANE);
  const pinned = await sessionCard("fo-pinned");
  await store.setAccountPinned(pinned.cardId, pinned.sessionId, true);
  const other = await sessionCard("fo-other", undefined, ACCOUNT_B);
  await handleUsageRead("default", usage(100));

  assert.equal(sessionOf(idle)?.claudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(limit)?.claudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(busy)?.claudeAccountId, "default");
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(pinned)?.claudeAccountId, "default");
  assert.equal(sessionOf(pinned)?.pendingClaudeAccountId, undefined);
  assert.equal(sessionOf(other)?.claudeAccountId, ACCOUNT_B);
  assert.equal(continued("fo-limit"), true);
  assert.equal(continued("fo-idle"), false);
  assert.equal(paneCalls("fo-pinned").length, 0);

  fs.writeFileSync(path.join(fake.state, "pane.dsp-fo-busy"), IDLE_PANE);
  await runPendingMove(busy.cardId, busy.sessionId);
  assert.equal(sessionOf(busy)?.claudeAccountId, ACCOUNT_A);
  assert.equal(continued("fo-busy"), false);
});

void test("a busy session queued by the chain that then reaches a limit gets Continue. when its queued move runs", async () => {
  await begin();
  const busy = await sessionCard("fq-busy", BUSY_PANE);
  await handleUsageRead("default", usage(100));
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, ACCOUNT_A);
  fs.writeFileSync(path.join(fake.state, "pane.dsp-fq-busy"), LIMIT_PANE);
  nextPane("fq-busy", IDLE_PANE);
  await sweepPendingMoves();
  assert.equal(sessionOf(busy)?.claudeAccountId, ACCOUNT_A);
  assert.equal(continued("fq-busy"), true);
});

void test("a limit session at a credits-only menu gets no key and stays (U2-12, no credits selection)", async () => {
  await begin();
  const credits = await sessionCard("cr-menu", NO_STOP_LIMIT_PANE);
  await handleUsageRead("default", usage(100));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(credits)?.claudeAccountId, "default");
  assert.deepEqual(paneCalls("cr-menu"), []);
});

void test("autoMove false moves nothing and emits one offer for the Switch now action (R-30)", async () => {
  await begin({ autoMove: false });
  const idle = await sessionCard("am-idle");
  await handleUsageRead("default", usage(100));
  await advance(2 * MIN);
  await handleUsageRead("default", usage(100));
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(idle)?.claudeAccountId, "default");
  assert.deepEqual(events, [
    {
      kind: "failover",
      from: "default",
      to: ACCOUNT_A,
      reason: "usage at the threshold",
      moved: false,
      sessions: 0,
    },
  ]);
  assert.deepEqual((await readChainState()).moves, []);
});

void test("return runs only on its timer and only after a fresh read below the threshold (U2-11)", async () => {
  await begin();
  const s = await sessionCard("rt-below");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  await advance(30 * MIN);
  await handleUsageRead("default", usage(10));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  await advance(31 * MIN);
  assert.equal(readLog.includes("default"), false);

  reads.set("default", usage(10));
  await advance(1 * MIN);
  assert.deepEqual(readLog, ["default"]);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
  assert.equal(continued("rt-below"), false);
  assert.deepEqual(events.at(-1), {
    kind: "return",
    from: ACCOUNT_A,
    to: "default",
    reason: "reset",
    moved: true,
    sessions: 1,
  });
});

void test("a read between the reset and the return timer keeps the timer, and the return still runs (U2-11)", async () => {
  await begin();
  const s = await sessionCard("rt-gap");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  await advance(61 * MIN);
  await handleUsageRead("default", usage(10));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.ok(chainTimers().some((t) => t.key === "return:default"));

  reads.set("default", usage(10));
  await advance(1 * MIN);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
});

void test("a fresh read still at the threshold reschedules to the new reset, or 15 minutes on with no new reset", async () => {
  await begin();
  await sessionCard("rt-above");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  reads.set("default", usage(100, iso(BASE + 180 * MIN)));
  await advance(62 * MIN);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.deepEqual(chainTimers(), [
    { key: "return:default", at: iso(BASE + 182 * MIN) },
  ]);

  reads.set("default", {
    ...usage(100, iso(BASE + 180 * MIN)),
    status: "rate-limited",
  });
  await advance(120 * MIN);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.deepEqual(chainTimers(), [
    { key: "return:default", at: iso(BASE + 197 * MIN) },
  ]);
});

void test("a restart rebuilds the return timer from chain-state.json and the return still runs", async () => {
  await begin();
  const s = await sessionCard("rs-restart");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
  stop();
  assert.deepEqual(due, []);
  stop = await startAccountChain(fakeDeps);
  assert.deepEqual(chainTimers(), [
    { key: "return:default", at: iso(BASE + 62 * MIN) },
  ]);
  reads.set("default", usage(5));
  await advance(62 * MIN);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
});

void test("exhausted: no move, the earliest reset is recorded, and after a restart each session at a limit continues at that reset (U2-12)", async () => {
  await begin();
  const limit = await sessionCard("ex-limit", LIMIT_PANE);
  const idle = await sessionCard("ex-idle");
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  await handleUsageRead(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  await handleUsageRead("default", usage(100, iso(BASE + 30 * MIN)));

  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(limit)?.claudeAccountId, "default");
  assert.equal(sessionOf(idle)?.claudeAccountId, "default");
  const saved = await readChainState();
  assert.deepEqual(saved.exhausted, {
    since: iso(BASE),
    earliestResetAt: iso(BASE + 30 * MIN),
  });
  assert.deepEqual(saved.moves, []);
  assert.deepEqual(events, [
    {
      kind: "exhausted",
      from: "default",
      earliestResetAt: iso(BASE + 30 * MIN),
    },
  ]);

  stop();
  stop = await startAccountChain(fakeDeps);
  assert.ok(
    chainTimers().some(
      (t) => t.key === "exhausted" && t.at === iso(BASE + 32 * MIN),
    ),
  );
  reads.set("default", usage(5));
  reads.set(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  reads.set(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  nextPane("ex-limit", IDLE_PANE);
  await advance(32 * MIN);

  assert.equal(getActiveAccountId(), "default");
  assert.equal((await readChainState()).exhausted, null);
  assert.ok(paneCalls("ex-limit").some((l) => l.endsWith("\tEscape")));
  assert.equal(continued("ex-limit"), true);
  assert.deepEqual(paneCalls("ex-idle"), []);
  assert.deepEqual((await readChainState()).moves, []);
});

void test("a surface left on screen past its reset neither limits the account again nor blocks the exhausted continue (U2-12)", async () => {
  await begin();
  const stalePane = surfaceAt(BASE + 30 * MIN);
  const limit = await sessionCard("ex-stale", stalePane);
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  await handleUsageRead(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  await handleUsageRead("default", usage(100, iso(BASE + 30 * MIN)));
  assert.equal(
    (await readChainState()).exhausted?.earliestResetAt,
    iso(BASE + 30 * MIN),
  );

  await advance(31 * MIN);
  reads.set("default", usage(5));
  reads.set(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  reads.set(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  await handleUsageRead("default", usage(5));
  await handleLimitSignal(limit.cardId, limit.sessionId, stalePane);
  const saved = await readChainState();
  assert.notEqual(saved.accounts.default?.state, "limited");
  assert.equal(saved.exhausted?.earliestResetAt, iso(BASE + 30 * MIN));

  nextPane("ex-stale", IDLE_PANE);
  await advance(1 * MIN);
  assert.equal((await readChainState()).exhausted, null);
  assert.equal(continued("ex-stale"), true);
  assert.equal(getActiveAccountId(), "default");
});

void test("requestFailover ignores autoMove and the dwell, skips pinned sessions, and refuses with no eligible account (U2-13)", async () => {
  await begin({ autoMove: false });
  const idle = await sessionCard("rf-idle");
  const pinned = await sessionCard("rf-pinned");
  await store.setAccountPinned(pinned.cardId, pinned.sessionId, true);

  const first = await requestFailover(SWITCH_NOW_REASON);
  assert.equal(first.ok && first.to, ACCOUNT_A);
  assert.equal(sessionOf(idle)?.claudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(pinned)?.claudeAccountId, "default");

  await advance(1 * MIN);
  const second = await requestFailover(SWITCH_NOW_REASON);
  assert.equal(second.ok && second.to, "default");
  assert.equal((await readChainState()).inUseSince, iso(BASE + MIN));

  await handleUsageRead(ACCOUNT_A, usage(100));
  await handleUsageRead(ACCOUNT_B, usage(100));
  assert.deepEqual(await requestFailover(SWITCH_NOW_REASON), {
    ok: false,
    error: "no-eligible-account",
  });
});

/** A read of `percent` with a status other than ok, which keeps the old `fetchedAt`. */
const failedRead = (
  status: ClaudeUsageSnapshot["status"],
  percent = 10,
): ClaudeUsageSnapshot => ({ ...usage(percent), status });

void test("a return timer on a 429, an error, a 401, an unavailable or a cached read changes nothing and checks again 15 minutes later (U2-11)", async () => {
  await begin();
  const s = await sessionCard("rt-fresh");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  let at = BASE + 62 * MIN;
  const bad: (ClaudeUsageSnapshot | "cached")[] = [
    failedRead("rate-limited"),
    failedRead("error"),
    failedRead("stale"),
    { ...failedRead("unavailable"), windows: [] },
    "cached",
  ];
  for (const read of bad) {
    if (read === "cached") {
      readMode = "cached";
      reads.set("default", usage(10));
    } else reads.set("default", read);
    await advance(at - clock);
    assert.equal(getActiveAccountId(), ACCOUNT_A);
    assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
    assert.equal((await readChainState()).accounts.default?.state, "limited");
    at += 15 * MIN;
    assert.deepEqual(chainTimers(), [{ key: "return:default", at: iso(at) }]);
  }
  readMode = "fresh";
  reads.set("default", usage(10));
  await advance(at - clock);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
});

void test("the exhausted check on a read that is not fresh and ok neither continues nor moves, and checks again 15 minutes later (U2-11)", async () => {
  await begin();
  const limit = await sessionCard("ex-fresh", LIMIT_PANE);
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  await handleUsageRead(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  await handleUsageRead("default", usage(100, iso(BASE + 30 * MIN)));
  reads.set("default", failedRead("rate-limited", 5));
  reads.set(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  reads.set(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  await advance(32 * MIN);
  assert.deepEqual(paneCalls("ex-fresh"), []);
  assert.notEqual((await readChainState()).exhausted, null);
  assert.ok(
    chainTimers().some(
      (t) => t.key === "exhausted" && t.at === iso(BASE + 47 * MIN),
    ),
  );

  reads.set("default", usage(5));
  nextPane("ex-fresh", IDLE_PANE);
  await advance(15 * MIN);
  assert.equal((await readChainState()).exhausted, null);
  assert.equal(continued("ex-fresh"), true);
  assert.equal(sessionOf(limit)?.claudeAccountId, "default");
});

void test("a pane surface fails over only when a fresh read is at the threshold or not ok, and caps its printed reset at 5 hours (U2-07)", async () => {
  await begin();
  const s = await sessionCard("ps-read", surfaceAt(BASE + 10 * 60 * MIN));
  reads.set("default", usage(10));
  await liveTurnState(s.cardId, s.sessionId, "dsp-ps-read");
  await whenChainIdle();
  assert.deepEqual(readLog, ["default"]);
  assert.equal(getActiveAccountId(), "default");
  assert.deepEqual(events, []);

  reads.set("default", failedRead("rate-limited"));
  await handleLimitSignal(
    s.cardId,
    s.sessionId,
    surfaceAt(BASE + 10 * 60 * MIN),
  );
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(
    (await readChainState()).accounts.default?.limitedUntil,
    iso(BASE + 5 * 60 * MIN),
  );
});

void test("a session marked stale sends no limit to the chain (C-10)", async () => {
  await begin();
  const s = await sessionCard("st-stale");
  await store.markAccountStale(s.cardId, s.sessionId);
  await handleLimitSignal(s.cardId, s.sessionId, null);
  assert.equal(getActiveAccountId(), "default");
  assert.deepEqual(events, []);
});

void test("continueAtLimit sends no key to a busy pane that still shows surface (a) text (C-04)", async () => {
  await begin();
  const s = await sessionCard(
    "cl-busy",
    `${surfaceAt(BASE + 60 * MIN)}\n${BUSY_PANE}`,
  );
  assert.equal(await continueAtLimit(s.cardId, s.sessionId), "none");
  assert.deepEqual(paneCalls("cl-busy"), []);
});

void test("continueAtLimit sends no key to the cancelled post-menu screen even with a hook limit (C-03b)", async () => {
  await begin();
  stop();
  const pane = fs.readFileSync(
    new URL(
      "../../test-support/fixtures/panes/limit-cancelled.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const s = await sessionCard("cl-cancelled", pane);
  recordTurnEvent(s.cardId, s.sessionId, "StopFailure", "rate_limit");
  assert.equal(await continueAtLimit(s.cardId, s.sessionId), "none");
  assert.deepEqual(paneCalls("cl-cancelled"), []);
});

void test("pinning a queued session drops its queued move, and a chain-queued move checks the pin again before it runs (U2-15)", async () => {
  await begin();
  const busy = await sessionCard("pn-busy", BUSY_PANE);
  await handleUsageRead("default", usage(100));
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, ACCOUNT_A);
  await store.setAccountPinned(busy.cardId, busy.sessionId, true);
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, undefined);

  await store.setPendingAccount(busy.cardId, busy.sessionId, ACCOUNT_A);
  fs.writeFileSync(path.join(fake.state, "pane.dsp-pn-busy"), IDLE_PANE);
  await runPendingMove(busy.cardId, busy.sessionId);
  assert.equal(sessionOf(busy)?.claudeAccountId, "default");
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, undefined);
  assert.deepEqual(paneCalls("pn-busy"), []);
});

void test("turning autoMove off drops every move the chain queued (U2-15)", async () => {
  await begin();
  const busy = await sessionCard("am-off", BUSY_PANE);
  await handleUsageRead("default", usage(100));
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, ACCOUNT_A);
  await updateChainSettings({ autoMove: false });
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, undefined);
});

void test("a hook limit with no surface on screen moves the session and sends Continue. (C-03b)", async () => {
  await begin();
  const s = await sessionCard("hl-idle");
  recordTurnEvent(s.cardId, s.sessionId, "StopFailure", "rate_limit");
  await whenChainIdle();
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
  assert.equal(continued("hl-idle"), true);
});

void test("Continue. is not typed when Claude is not ready after the move or the pane shows a surface (C-05)", async () => {
  await begin();
  const s = await sessionCard("cn-missing", LIMIT_PANE);
  await store.setClaudeSessionId(s.cardId, s.sessionId, "missing-1");
  nextPane("cn-missing", IDLE_PANE);
  await handleUsageRead("default", usage(100));
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
  assert.equal(continued("cn-missing"), false);

  const at = await sessionCard("cn-surface", LIMIT_PANE, ACCOUNT_A);
  assert.equal(await sendContinuePrompt(at.cardId, at.sessionId), false);
  assert.equal(continued("cn-surface"), false);
  fs.writeFileSync(path.join(fake.state, "pane.dsp-cn-surface"), IDLE_PANE);
  assert.equal(await sendContinuePrompt(at.cardId, at.sessionId), true);
  assert.equal(continued("cn-surface"), true);
});

void test("a timer task that throws runs again 15 minutes later (C-07)", async () => {
  await begin();
  await sessionCard("tt-throw");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  readMode = "throw";
  await advance(62 * MIN);
  assert.deepEqual(chainTimers(), [
    { key: "return:default", at: iso(BASE + 77 * MIN) },
  ]);
  readMode = "fresh";
  reads.set("default", usage(10));
  await advance(15 * MIN);
  assert.equal(getActiveAccountId(), "default");
});

void test("a reset more than 24 days out arms at most 24 days ahead and still fires at its time (F10)", async () => {
  await begin();
  await sessionCard("tt-far");
  const far = BASE + 40 * 24 * 60 * MIN;
  await handleUsageRead("default", usage(100, iso(far)));
  assert.ok(due.every((t) => t.at - clock <= 24 * 24 * 60 * MIN));
  await advance(25 * 24 * 60 * MIN);
  assert.deepEqual(readLog, []);
  assert.deepEqual(chainTimers(), [
    { key: "return:default", at: iso(far + 2 * MIN) },
  ]);
  reads.set("default", usage(10));
  await advance(far + 2 * MIN - clock);
  assert.deepEqual(readLog, ["default"]);
  assert.equal(getActiveAccountId(), "default");
});

void test("the 30 s scan fires a timer whose wall clock time passed while the timers slept (F3)", async () => {
  await begin({}, { scanMs: 10 });
  const s = await sessionCard("tt-sleep");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  reads.set("default", usage(10));
  clock = BASE + 63 * MIN;
  await new Promise((resolve) => setTimeout(resolve, 100));
  await whenChainIdle();
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
});

void test("at boot a return check runs for the account the chain last left once it is no longer limited, never after a manual pick (C-07)", async () => {
  await begin();
  const s = await sessionCard("bt-lost", undefined, ACCOUNT_A);
  const accounts = {
    default: { state: "available" as const, buckets: [], limitedUntil: null },
    [ACCOUNT_B]: {
      state: "available" as const,
      buckets: [],
      limitedUntil: null,
    },
  };
  stop();
  await writeChainState({ ...emptyChainState(), accounts });
  await setActiveAccount(ACCOUNT_A);
  stop = await startAccountChain(fakeDeps);
  assert.deepEqual(chainTimers(), []);

  stop();
  const chainMove = {
    at: iso(BASE),
    from: "default",
    to: ACCOUNT_A,
    reason: "usage at the threshold",
  };
  await writeChainState({
    ...emptyChainState(),
    accounts,
    moves: [chainMove],
  });
  stop = await startAccountChain(fakeDeps);
  assert.deepEqual(chainTimers(), []);

  stop();
  await writeChainState({
    ...emptyChainState(),
    accounts,
    inUseSince: iso(BASE),
    moves: [chainMove],
  });
  stop = await startAccountChain(fakeDeps);
  assert.deepEqual(chainTimers(), [{ key: "return:default", at: iso(BASE) }]);
  reads.set("default", usage(10));
  await advance(0);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
});

void test("a restart never undoes a Switch now move", async () => {
  await begin();
  await sessionCard("bt-manual", undefined, ACCOUNT_A);
  stop();
  await writeChainState({
    ...emptyChainState(),
    accounts: {
      default: { state: "available", buckets: [], limitedUntil: null },
    },
    moves: [
      {
        at: iso(BASE),
        from: "default",
        to: ACCOUNT_A,
        reason: SWITCH_NOW_REASON,
      },
    ],
  });
  await setActiveAccount(ACCOUNT_A);
  stop = await startAccountChain(fakeDeps);
  assert.deepEqual(chainTimers(), []);
});

void test("a session pinned while an automatic move runs is not moved", async () => {
  await begin();
  const first = await sessionCard("pm-first");
  const late = await sessionCard("pm-late");
  const lateRef = { cardId: late.cardId, sessionId: late.sessionId };
  let pinnedLate = false;
  const pinOnFirstMove = setInterval(() => {
    if (!pinnedLate && sessionOf(first)?.claudeAccountId === ACCOUNT_A) {
      pinnedLate = true;
      void store.setAccountPinned(lateRef.cardId, lateRef.sessionId, true);
    }
  }, 5);
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  clearInterval(pinOnFirstMove);
  assert.equal(pinnedLate, true);
  assert.equal(sessionOf(first)?.claudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(late)?.claudeAccountId, "default");
});

void test("with autoMove false a new limit after the account left limited sends a new offer (F1, C-08)", async () => {
  await begin({ autoMove: false });
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  reads.set("default", usage(10));
  await advance(62 * MIN);
  await handleUsageRead("default", usage(100, iso(clock + 60 * MIN)));
  assert.deepEqual(
    events.map((e) => e.kind),
    ["failover", "failover"],
  );
});

void test("a session whose automatic move step throws lands in skipped as error, the rest still move, and the move is still recorded (F4, C-06)", async () => {
  await begin();
  const idle = await sessionCard("pf-idle");
  const busy = await sessionCard("pf-busy", BUSY_PANE);
  const setPending = mock.method(store, "setPendingAccount", () =>
    Promise.reject(new Error("store down")),
  );
  try {
    const result = await requestFailover(SWITCH_NOW_REASON);
    assert.ok(result.ok);
    assert.deepEqual(result.moves.moved, [
      { cardId: idle.cardId, sessionId: idle.sessionId },
    ]);
    assert.deepEqual(result.moves.skipped, [
      { cardId: busy.cardId, sessionId: busy.sessionId, reason: "error" },
    ]);
  } finally {
    setPending.mock.restore();
  }
  assert.equal(events.length, 1);

  const clear = mock.method(store, "sessionsWithTmux", () => {
    throw new Error("store down");
  });
  try {
    await assert.rejects(requestFailover(SWITCH_NOW_REASON));
  } finally {
    clear.mock.restore();
  }
  assert.equal(events.length, 2);
  assert.equal(events[1]?.kind, "failover");
});

void test("removing an account drops its chain entry and its return timer (F9)", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, usage(100));
  assert.ok(chainTimers().some((t) => t.key === `return:${ACCOUNT_A}`));
  await forgetChainAccount(ACCOUNT_A);
  assert.equal(
    chainTimers().some((t) => t.key === `return:${ACCOUNT_A}`),
    false,
  );
  assert.equal((await readChainState()).accounts[ACCOUNT_A], undefined);
});

void test("removing an account drops its login expiry notice", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, {
    ...usage(10),
    loginExpiresAt: iso(BASE + 2 * 24 * 60 * MIN),
  });
  assert.deepEqual(Object.keys((await readChainState()).loginExpiryNotified), [
    ACCOUNT_A,
  ]);
  await forgetChainAccount(ACCOUNT_A);
  assert.deepEqual((await readChainState()).loginExpiryNotified, {});
});

void test("a second failover inside one busy turn re-targets the queued move, and the session runs on the new account after its Stop", async () => {
  await begin();
  const busy = await sessionCard("df-busy", BUSY_PANE);
  const idle = await sessionCard("df-idle");
  await handleUsageRead("default", usage(100));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(idle)?.claudeAccountId, ACCOUNT_A);

  claudeInForeground();
  await handleLimitSignal(idle.cardId, idle.sessionId, null);
  assert.equal(getActiveAccountId(), ACCOUNT_B);
  assert.equal(sessionOf(busy)?.claudeAccountId, "default");
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, ACCOUNT_B);
  assert.deepEqual(
    events.map((e) => ("sessions" in e ? e.sessions : null)),
    [2, 2],
  );

  fs.writeFileSync(path.join(fake.state, "pane.dsp-df-busy"), LIMIT_PANE);
  nextPane("df-busy", IDLE_PANE);
  await runPendingMove(busy.cardId, busy.sessionId);
  assert.equal(sessionOf(busy)?.claudeAccountId, ACCOUNT_B);
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, undefined);
  assert.equal(continued("df-busy"), true);
});

void test("a manual queued move to another account survives a chain move", async () => {
  await begin();
  const busy = await sessionCard("mq-busy", BUSY_PANE);
  assert.equal(
    await moveOrQueue(busy.cardId, ACCOUNT_B, busy.sessionId),
    "queued",
  );
  await handleUsageRead("default", usage(100));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(busy)?.pendingClaudeAccountId, ACCOUNT_B);

  fs.writeFileSync(path.join(fake.state, "pane.dsp-mq-busy"), IDLE_PANE);
  await runPendingMove(busy.cardId, busy.sessionId);
  assert.equal(sessionOf(busy)?.claudeAccountId, ACCOUNT_B);
});

void test("continueAtLimit sends no key when the pane is at a shell prompt", async () => {
  await begin();
  const s = await sessionCard("cl-shell", LIMIT_PANE);
  const atPrompt = path.join(fake.state, "at-prompt");
  fs.writeFileSync(atPrompt, "");
  try {
    assert.equal(await continueAtLimit(s.cardId, s.sessionId), "none");
  } finally {
    fs.rmSync(atPrompt);
  }
  assert.deepEqual(paneCalls("cl-shell"), []);
});

void test("sendContinuePrompt types nothing on a busy pane that shows the ready footer", async () => {
  await begin();
  const s = await sessionCard("sc-busy", `${BUSY_PANE}${IDLE_PANE}`);
  assert.equal(await sendContinuePrompt(s.cardId, s.sessionId), false);
  assert.deepEqual(paneCalls("sc-busy"), []);
});

void test("sendContinuePrompt types nothing on a pane with a limit surface above the ready footer", async () => {
  await begin();
  const s = await sessionCard("sc-surface", `${LIMIT_PANE}${IDLE_PANE}`);
  assert.equal(await sendContinuePrompt(s.cardId, s.sessionId), false);
  assert.deepEqual(paneCalls("sc-surface"), []);
});

void test("sendContinuePrompt types nothing on a pane with no ready footer", async () => {
  await begin();
  const s = await sessionCard("sc-footer", "Some output\n> \n");
  assert.equal(await sendContinuePrompt(s.cardId, s.sessionId), false);
  assert.deepEqual(paneCalls("sc-footer"), []);
});

void test("a return never moves work down the chain", async () => {
  await begin();
  const s = await sessionCard("rk-down");
  await handleUsageRead(ACCOUNT_B, usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), "default");
  reads.set(ACCOUNT_B, usage(10));
  await advance(62 * MIN);
  assert.deepEqual(readLog, [ACCOUNT_B]);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
  assert.deepEqual(events, []);
});

void test("an ok read below the threshold before limitedUntil clears the limit, so a failover may select the account", async () => {
  await begin();
  const s = await sessionCard("hd-clear");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  await advance(5 * MIN);
  await handleUsageRead("default", usage(10));
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "available");
  assert.equal(saved.accounts.default?.limitedUntil, null);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.ok(chainTimers().some((t) => t.key === "return:default"));

  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  claudeInForeground();
  await handleLimitSignal(s.cardId, s.sessionId, null);
  assert.equal(getActiveAccountId(), "default");
});

void test("a rate-limited read before limitedUntil keeps the account limited, so a failover skips it", async () => {
  await begin();
  const s = await sessionCard("hd-held");
  const lastGood = usage(100, iso(BASE + 60 * MIN));
  await handleUsageRead("default", lastGood);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  await advance(5 * MIN);
  await handleUsageRead("default", { ...lastGood, status: "rate-limited" });
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "limited");
  assert.equal(saved.accounts.default?.limitedUntil, iso(BASE + 60 * MIN));

  claudeInForeground();
  await handleLimitSignal(s.cardId, s.sessionId, null);
  assert.equal(getActiveAccountId(), ACCOUNT_B);
});

void test("an ok read with no windows before limitedUntil keeps the account limited", async () => {
  await begin();
  await sessionCard("hd-empty");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  await advance(5 * MIN);
  await handleUsageRead("default", { ...usage(10), windows: [] });
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "limited");
  assert.equal(saved.accounts.default?.limitedUntil, iso(BASE + 60 * MIN));
});

void test("an ok read at the threshold before limitedUntil keeps the account limited", async () => {
  await begin();
  await sessionCard("hd-at");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  await advance(5 * MIN);
  await handleUsageRead("default", usage(100, iso(BASE + 90 * MIN)));
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "limited");
  assert.equal(saved.accounts.default?.limitedUntil, iso(BASE + 90 * MIN));
});

void test("the exhausted check never continues on an account it has no fresh ok read for, even when a poll cleared it", async () => {
  await begin();
  await sessionCard("eg-gate", LIMIT_PANE);
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  await handleUsageRead(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  await handleUsageRead("default", usage(100, iso(BASE + 30 * MIN)));
  assert.notEqual((await readChainState()).exhausted, null);

  await advance(31 * MIN);
  await handleUsageRead("default", failedRead("rate-limited", 5));
  assert.notEqual((await readChainState()).accounts.default?.state, "limited");
  reads.set("default", failedRead("rate-limited", 5));
  reads.set(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  reads.set(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  await advance(1 * MIN);
  assert.deepEqual(paneCalls("eg-gate"), []);
  assert.notEqual((await readChainState()).exhausted, null);
  assert.ok(
    chainTimers().some(
      (t) => t.key === "exhausted" && t.at === iso(BASE + 47 * MIN),
    ),
  );
});

void test("the exhausted check moves the work to another account that reset first", async () => {
  await begin();
  const idle = await sessionCard("eg-other");
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 30 * MIN)));
  await handleUsageRead(ACCOUNT_B, usage(100, iso(BASE + 90 * MIN)));
  await handleUsageRead("default", usage(100, iso(BASE + 120 * MIN)));
  assert.equal(
    (await readChainState()).exhausted?.earliestResetAt,
    iso(BASE + 30 * MIN),
  );

  reads.set("default", usage(100, iso(BASE + 120 * MIN)));
  reads.set(ACCOUNT_A, usage(5));
  reads.set(ACCOUNT_B, usage(100, iso(BASE + 90 * MIN)));
  await advance(32 * MIN);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(idle)?.claudeAccountId, ACCOUNT_A);
  assert.equal((await readChainState()).exhausted, null);
  assert.deepEqual(events.at(-1), {
    kind: "failover",
    from: "default",
    to: ACCOUNT_A,
    reason: "reset",
    moved: true,
    sessions: 1,
  });
});

void test("a usage trigger inside the dwell moves nothing, and the same trigger after the dwell moves once", async () => {
  await begin();
  const s = await sessionCard("dx-idle");
  await handleUsageRead("default", usage(100, iso(BASE + 600 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal((await readChainState()).moves.length, 1);

  await advance(5 * MIN);
  await handleUsageRead(ACCOUNT_A, usage(100, iso(clock + 600 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal((await readChainState()).moves.length, 1);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);

  await advance(11 * MIN);
  claudeInForeground();
  await handleUsageRead(ACCOUNT_A, usage(100, iso(clock + 600 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_B);
  assert.equal((await readChainState()).moves.length, 2);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_B);
});

void test("a pane surface whose printed time just passed, with a newer ok read below the threshold, reads nothing, moves nothing and emits nothing", async () => {
  const refreshed: string[] = [];
  await begin(
    {},
    {
      refreshUsage: (id: string) => {
        refreshed.push(id);
        return Promise.resolve(usage(100));
      },
    },
  );
  const pane = surfaceAt(BASE - 30 * MIN);
  const s = await sessionCard("sf-stale", pane);
  reads.set("default", usage(10));
  await handleLimitSignal(s.cardId, s.sessionId, pane);
  assert.deepEqual(refreshed, []);
  assert.equal(getActiveAccountId(), "default");
  assert.deepEqual(events, []);
  const saved = await readChainState();
  assert.equal(saved.exhausted, null);
  assert.deepEqual(saved.moves, []);
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
});

void test("a usage refresh through the real refreshUsage at the threshold on the account in use fails over", async () => {
  await begin();
  const s = await sessionCard("wr-idle");
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        five_hour: { utilization: 100, resets_at: iso(BASE + 60 * MIN) },
        seven_day: null,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const prior = process.env.DISPATCH_USAGE_URL;
  process.env.DISPATCH_USAGE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/usage`;
  try {
    const snapshot = await refreshUsage("default");
    assert.equal(snapshot.status, "ok");
    await whenChainIdle();
  } finally {
    process.env.DISPATCH_USAGE_URL = prior;
    await new Promise((resolve) => server.close(resolve));
  }
  assert.deepEqual(readLog, []);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
  assert.equal(events.length, 1);
});

void test("with thresholdPercent 90 a read of 89 moves nothing and a read of 90 fails over", async () => {
  await begin();
  const s = await sessionCard("th-idle");
  updateClaudeAccountsSettings({ thresholdPercent: 90 });
  try {
    await handleUsageRead("default", usage(89));
    assert.equal(getActiveAccountId(), "default");
    assert.deepEqual(events, []);
    assert.equal(sessionOf(s)?.claudeAccountId, "default");

    await handleUsageRead("default", usage(90));
    assert.equal(getActiveAccountId(), ACCOUNT_A);
    assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
    assert.equal(events.length, 1);
  } finally {
    updateClaudeAccountsSettings({ thresholdPercent: 100 });
  }
});

void test("a session busy when the return runs is queued and runs on the earlier account after its Stop", async () => {
  await begin();
  const s = await sessionCard("rb-busy");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);

  claudeInForeground();
  fs.writeFileSync(path.join(fake.state, "pane.dsp-rb-busy"), BUSY_PANE);
  reads.set("default", usage(10));
  await advance(62 * MIN);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(s)?.pendingClaudeAccountId, "default");
  assert.deepEqual(events.at(-1), {
    kind: "return",
    from: ACCOUNT_A,
    to: "default",
    reason: "reset",
    moved: true,
    sessions: 1,
  });

  fs.writeFileSync(path.join(fake.state, "pane.dsp-rb-busy"), IDLE_PANE);
  recordTurnEvent(s.cardId, s.sessionId, "Stop", undefined);
  await runPendingMove(s.cardId, s.sessionId);
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
  assert.equal(sessionOf(s)?.pendingClaudeAccountId, undefined);
});

void test("updateChainSettings with autoMove already off leaves every queued move alone", async () => {
  await begin();
  const chainQueued = await sessionCard("wa-chain", BUSY_PANE);
  const manual = await sessionCard("wa-manual", BUSY_PANE);
  assert.equal(
    await moveOrQueue(manual.cardId, ACCOUNT_B, manual.sessionId),
    "queued",
  );
  await handleUsageRead("default", usage(100));
  assert.equal(sessionOf(chainQueued)?.pendingClaudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(manual)?.pendingClaudeAccountId, ACCOUNT_B);

  updateClaudeAccountsSettings({ autoMove: false });
  await updateChainSettings({ autoMove: false });
  assert.equal(sessionOf(chainQueued)?.pendingClaudeAccountId, ACCOUNT_A);
  assert.equal(sessionOf(manual)?.pendingClaudeAccountId, ACCOUNT_B);
});

void test("the 30 s scan leaves a timer that is not yet due alone", async () => {
  await begin({}, { scanMs: 10 });
  const s = await sessionCard("tt-early");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  reads.set("default", usage(10));
  readLog.length = 0;
  clock = BASE + 30 * MIN;
  await new Promise((resolve) => setTimeout(resolve, 100));
  await whenChainIdle();
  assert.deepEqual(
    readLog.filter((id) => id === "default"),
    [],
  );
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
});

const HYSTERESIS = { thresholdPercent: 90, hysteresisPercent: 10 };

const failoverMoves = (): ChainEvent[] =>
  events.filter((e) => e.kind === "failover" && e.moved);

void test("hysteresis: ten usage reads at 92 across one dwell, with every other account at 92, make no move", async () => {
  await begin(HYSTERESIS);
  await sessionCard("hy-flat");
  await handleUsageRead(ACCOUNT_A, usage(92));
  await handleUsageRead(ACCOUNT_B, usage(92));
  for (let i = 0; i < 10; i++) {
    await handleUsageRead("default", usage(92));
    await advance(MIN);
  }
  assert.equal(getActiveAccountId(), "default");
  assert.deepEqual(failoverMoves(), []);
  assert.deepEqual((await readChainState()).moves, []);
});

void test("hysteresis: a usage read at 92 moves once to a candidate at 75", async () => {
  await begin(HYSTERESIS);
  const s = await sessionCard("hy-below");
  await handleUsageRead(ACCOUNT_A, usage(75));
  await handleUsageRead("default", usage(92));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
  assert.equal(failoverMoves().length, 1);
  assert.equal((await readChainState()).moves.length, 1);
});

void test("hysteresis: a usage read at 92 with the only candidate at 85 stays and does not mark the chain exhausted", async () => {
  await begin(HYSTERESIS);
  const s = await sessionCard("hy-stay");
  await handleUsageRead(ACCOUNT_A, usage(85));
  await handleUsageRead(ACCOUNT_B, usage(100));
  await handleUsageRead("default", usage(92));
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
  assert.deepEqual(events, []);
  assert.equal((await readChainState()).exhausted, null);
});

void test("hysteresis: a usage read at 92 with every candidate limited marks the chain exhausted", async () => {
  await begin(HYSTERESIS);
  const s = await sessionCard("hy-exhausted");
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  await handleUsageRead(ACCOUNT_B, usage(100, iso(BASE + 120 * MIN)));
  await handleUsageRead("default", usage(92, iso(BASE + 30 * MIN)));
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
  assert.notEqual((await readChainState()).exhausted, null);
  assert.deepEqual(failoverMoves(), []);
  assert.deepEqual(events, [
    {
      kind: "exhausted",
      from: "default",
      earliestResetAt: iso(BASE + 30 * MIN),
    },
  ]);
});

void test("hysteresis: a candidate that was never read does not pass the rule", async () => {
  await begin(HYSTERESIS);
  await sessionCard("hy-unread");
  await handleUsageRead("default", usage(92));
  assert.equal(getActiveAccountId(), "default");
  assert.deepEqual(events, []);
});

void test("hysteresis: a limit surface moves to a candidate at 85", async () => {
  await begin(HYSTERESIS);
  const s = await sessionCard("hy-surface", surfaceAt(BASE + 60 * MIN));
  await handleUsageRead(ACCOUNT_A, usage(85));
  await handleUsageRead(ACCOUNT_B, usage(100));
  reads.set("default", usage(92));
  nextPane("hy-surface", IDLE_PANE);
  await handleLimitSignal(s.cardId, s.sessionId, surfaceAt(BASE + 60 * MIN));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(failoverMoves().length, 1);
});

void test("hysteresis: a rate limit StopFailure moves to a candidate at 85", async () => {
  await begin(HYSTERESIS);
  const s = await sessionCard("hy-stop");
  await handleUsageRead(ACCOUNT_A, usage(85));
  await handleUsageRead(ACCOUNT_B, usage(100));
  await handleLimitSignal(s.cardId, s.sessionId, null);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(failoverMoves().length, 1);
});

void test("hysteresis: a return to an account at 85 waits and checks again, and a return to an account at 70 runs", async () => {
  await begin(HYSTERESIS);
  const s = await sessionCard("hy-return");
  await handleUsageRead(ACCOUNT_A, usage(75));
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);

  reads.set("default", usage(85));
  await advance(62 * MIN);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
  assert.deepEqual(chainTimers(), [
    { key: "return:default", at: iso(clock + 15 * MIN) },
  ]);

  reads.set("default", usage(70));
  await advance(15 * MIN);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(sessionOf(s)?.claudeAccountId, "default");
});

void test("hysteresis: a lower-ranked account at 85 after its reset schedules no return timer and is not read again", async () => {
  await begin(HYSTERESIS);
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), "default");
  reads.set(ACCOUNT_A, usage(85));
  await advance(62 * MIN);
  assert.deepEqual(readLog, [ACCOUNT_A]);
  assert.equal(
    chainTimers().some((t) => t.key === `return:${ACCOUNT_A}`),
    false,
  );
  await advance(30 * MIN);
  assert.deepEqual(readLog, [ACCOUNT_A]);
});

void test("hysteresis: Switch now moves to a candidate at 85", async () => {
  await begin(HYSTERESIS);
  await sessionCard("hy-switch");
  await handleUsageRead(ACCOUNT_A, usage(85));
  const result = await requestFailover(SWITCH_NOW_REASON);
  assert.equal(result.ok && result.to, ACCOUNT_A);
});

void test("hysteresis: the exhausted check selects a candidate at 85", async () => {
  await begin(HYSTERESIS);
  const idle = await sessionCard("hy-exhausted");
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 30 * MIN)));
  await handleUsageRead(ACCOUNT_B, usage(100, iso(BASE + 90 * MIN)));
  await handleUsageRead("default", usage(100, iso(BASE + 120 * MIN)));
  reads.set("default", usage(100, iso(BASE + 120 * MIN)));
  reads.set(ACCOUNT_A, usage(85));
  reads.set(ACCOUNT_B, usage(100, iso(BASE + 90 * MIN)));
  await advance(32 * MIN);
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(sessionOf(idle)?.claudeAccountId, ACCOUNT_A);
});

void test("hysteresis 0 behaves as before: a usage read moves to a candidate at 85", async () => {
  await begin({ thresholdPercent: 90, hysteresisPercent: 0 });
  await sessionCard("hy-zero");
  await handleUsageRead(ACCOUNT_A, usage(85));
  await handleUsageRead("default", usage(92));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  assert.equal(failoverMoves().length, 1);
});

void test("a failover never picks a signed-out account", async () => {
  await begin({}, { loggedIn: () => Promise.resolve(false) });
  const s = await sessionCard("so-skip");
  reads.set(ACCOUNT_A, failedRead("unavailable"));
  await handleUsageRead(ACCOUNT_A, failedRead("unavailable"));
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "login-expired",
  );
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_B);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_B);
});

void test("login expiry: one login-expiring event per expiry value, kept across a restart, new value warns again, 4 days out is silent", async () => {
  await begin();
  const DAY = 24 * 60 * 60 * 1000;
  const expiring = (ms: number): ClaudeUsageSnapshot => ({
    ...usage(10),
    loginExpiresAt: iso(BASE + ms),
  });
  await handleUsageRead(ACCOUNT_A, expiring(4 * DAY));
  assert.deepEqual(events, []);

  await handleUsageRead(ACCOUNT_A, expiring(2 * DAY));
  assert.deepEqual(events, [
    {
      kind: "login-expiring",
      account: ACCOUNT_A,
      expiresAt: iso(BASE + 2 * DAY),
    },
  ]);
  assert.deepEqual((await readChainState()).loginExpiryNotified, {
    [ACCOUNT_A]: iso(BASE + 2 * DAY),
  });

  await handleUsageRead(ACCOUNT_A, expiring(2 * DAY));
  assert.equal(events.length, 1);

  stop();
  stop = await startAccountChain(fakeDeps);
  await handleUsageRead(ACCOUNT_A, expiring(2 * DAY));
  assert.equal(events.length, 1);

  await handleUsageRead(ACCOUNT_A, expiring(2 * DAY + MIN));
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], {
    kind: "login-expiring",
    account: ACCOUNT_A,
    expiresAt: iso(BASE + 2 * DAY + MIN),
  });
});

void test("login expiry: a past expiry sends one login-expiring event and none after a restart", async () => {
  await begin();
  const DAY = 24 * 60 * 60 * 1000;
  const expired: ClaudeUsageSnapshot = {
    ...usage(10),
    loginExpiresAt: iso(BASE - DAY),
  };
  await handleUsageRead(ACCOUNT_A, expired);
  const expiring = (): ChainEvent[] =>
    events.filter((e) => e.kind === "login-expiring");
  assert.deepEqual(expiring(), [
    {
      kind: "login-expiring",
      account: ACCOUNT_A,
      expiresAt: iso(BASE - DAY),
    },
  ]);

  stop();
  stop = await startAccountChain(fakeDeps);
  await handleUsageRead(ACCOUNT_A, expired);
  assert.equal(expiring().length, 1);
});

const TICKET_CLOCK = Date.parse("2026-10-20T10:10:00.000Z");
const TICKET_LIMITED_UNTIL = "2026-10-22T07:00:00.000Z";
const TICKET_WEEKLY_RESET = "2026-10-27T07:00:00.000Z";
const TICKET_OLD_FETCH = "2026-10-19T10:00:00.000Z";
const WEEK = 7 * 24 * 60 * MIN;

/** A usage window of `kind` at `percent` whose period began `spanMs` before `resetsAt`. */
function periodWindow(
  kind: string,
  label: string,
  percent: number,
  resetsAt: string,
  spanMs: number,
): ClaudeUsageWindow {
  return {
    kind,
    label,
    percent,
    resetsAt,
    isActive: kind === "session",
    periodStart: iso(Date.parse(resetsAt) - spanMs),
    periodEnd: resetsAt,
  };
}

/** The windows of the 2026-10-20 ticket snapshot, where the weekly buckets just started a new period. */
function newPeriodWindows(): ClaudeUsageWindow[] {
  return [
    periodWindow(
      "session",
      "Session",
      4,
      iso(TICKET_CLOCK + 3 * 60 * MIN),
      5 * 60 * MIN,
    ),
    periodWindow("weekly_all", "Weekly", 1, TICKET_WEEKLY_RESET, WEEK),
    periodWindow("weekly_scoped", "Weekly Fable", 2, TICKET_WEEKLY_RESET, WEEK),
  ];
}

/** The windows the account showed when it hit the weekly limit. */
function oldPeriodWindows(): ClaudeUsageWindow[] {
  return [
    periodWindow("weekly_all", "Weekly", 100, TICKET_LIMITED_UNTIL, WEEK),
  ];
}

/** Start the controller with `default` stored as limited by a weekly bucket read at `TICKET_OLD_FETCH`. */
async function beginWithStoredWeeklyLimit(): Promise<void> {
  await begin();
  const state = emptyChainState();
  state.accounts.default = {
    state: "limited",
    limitedUntil: TICKET_LIMITED_UNTIL,
    buckets: [
      { kind: "weekly_all", percent: 100, resetsAt: TICKET_LIMITED_UNTIL },
    ],
    fetchedAt: TICKET_OLD_FETCH,
  };
  await writeChainState(state);
  clock = TICKET_CLOCK;
  stop();
  stop = await startAccountChain(fakeDeps);
}

void test("a managed login drops the stale default entry from the chain", async () => {
  await beginWithStoredWeeklyLimit();
  assert.ok((await readChainState()).accounts.default);
  const { startLogin, submitLoginCode, getLoginView } =
    await import("./claude-login.js");
  assert.deepEqual(await startLogin(undefined, { managedDefault: true }), {
    ok: true,
  });
  for (let i = 0; getLoginView().state !== "awaiting-code" && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.deepEqual(submitLoginCode("home"), { ok: true });
  for (let i = 0; getLoginView().state !== "done" && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const view = getLoginView();
  assert.equal(view.state, "done");
  try {
    await whenChainIdle();
    assert.equal((await readChainState()).accounts.default, undefined);
  } finally {
    if (view.state === "done") await removeAccount(view.account.id);
    await setActiveAccount("default");
  }
});

void test("an ok read that shows a new period releases a limited account in one read", async () => {
  await beginWithStoredWeeklyLimit();
  await handleUsageRead("default", {
    status: "ok",
    fetchedAt: iso(clock),
    windows: newPeriodWindows(),
  });
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "available");
  assert.equal(saved.accounts.default?.limitedUntil, null);
  assert.equal(saved.accounts.default?.fetchedAt, iso(clock));
  assert.equal(getActiveAccountId(), "default");
  assert.deepEqual(events, []);
  assert.ok(chainTimers().some((t) => t.key === "return:default"));
});

void test("a rate-limited read with a newer fetchedAt and new period windows releases a limited account", async () => {
  await beginWithStoredWeeklyLimit();
  await handleUsageRead("default", {
    status: "rate-limited",
    fetchedAt: iso(clock - MIN),
    windows: newPeriodWindows(),
  });
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "available");
  assert.equal(saved.accounts.default?.limitedUntil, null);
  assert.equal(getActiveAccountId(), "default");
});

void test("a rate-limited read that repeats the old windows and fetchedAt keeps the account limited", async () => {
  await beginWithStoredWeeklyLimit();
  await handleUsageRead("default", {
    status: "rate-limited",
    fetchedAt: TICKET_OLD_FETCH,
    windows: oldPeriodWindows(),
  });
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "limited");
  assert.equal(saved.accounts.default?.limitedUntil, TICKET_LIMITED_UNTIL);
  assert.equal(saved.accounts.default?.fetchedAt, TICKET_OLD_FETCH);
});

void test("a stale token-rejected read with a newer fetchedAt and new period windows keeps a limited account limited", async () => {
  await beginWithStoredWeeklyLimit();
  await handleUsageRead("default", {
    status: "stale",
    error: "token-rejected",
    fetchedAt: iso(clock - MIN),
    windows: newPeriodWindows(),
  });
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "limited");
  assert.equal(saved.accounts.default?.limitedUntil, TICKET_LIMITED_UNTIL);
});

const rejectedRead = (prior: ClaudeUsageSnapshot): ClaudeUsageSnapshot => ({
  status: "stale",
  error: "token-rejected",
  windows: prior.windows,
  fetchedAt: prior.fetchedAt,
});

void test("one token-rejected read keeps the account out of needs-login and raises nothing", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  const saved = (await readChainState()).accounts[ACCOUNT_A];
  assert.notEqual(saved?.state, "needs-login");
  assert.equal(saved?.rejectedReads, 1);
  assert.deepEqual(raised, []);
});

void test("two token-expired reads keep the account unknown and eligible and raise nothing", async () => {
  await begin();
  for (let i = 0; i < 3; i++) {
    await handleUsageRead(ACCOUNT_A, {
      ...rejectedRead(usage(10)),
      error: "token-expired",
    });
  }
  const saved = (await readChainState()).accounts[ACCOUNT_A];
  assert.equal(saved?.state, "unknown");
  assert.notEqual(saved?.rejectedReads, 3);
  assert.deepEqual(raised, []);
});

void test("two token-rejected reads make needs-login and raise one decision, and later reads raise nothing", async () => {
  await begin();
  for (let i = 0; i < 4; i++) {
    await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  }
  const saved = await readChainState();
  assert.equal(saved.accounts[ACCOUNT_A]?.state, "needs-login");
  assert.equal(saved.accounts[ACCOUNT_A]?.limitedUntil, null);
  assert.equal(saved.accounts[ACCOUNT_A]?.rejectedReads, 4);
  assert.deepEqual(raised, [ACCOUNT_A]);
  const decisionId = saved.decisions[`needs-login:${ACCOUNT_A}`];
  assert.equal(store.getDecisionItem(decisionId ?? "")?.state, "open");
  assert.deepEqual(
    chainTimers().filter((t) => t.key === `return:${ACCOUNT_A}`),
    [],
  );
});

void test("a limited account that becomes needs-login loses its return timer", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 60 * MIN)));
  assert.equal(
    chainTimers().some((t) => t.key === `return:${ACCOUNT_A}`),
    true,
  );
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(100)));
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(100)));
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "needs-login",
  );
  assert.deepEqual(
    chainTimers().filter((t) => t.key === `return:${ACCOUNT_A}`),
    [],
  );
});

void test("removing an account whose decision close throws does not throw and drops the stored id", async () => {
  await begin(
    {},
    {
      closeDecision: () => {
        throw new Error("close failed");
      },
    },
  );
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await forgetChainAccount(ACCOUNT_A);
  const saved = await readChainState();
  assert.equal(saved.accounts[ACCOUNT_A], undefined);
  assert.equal(saved.decisions[`needs-login:${ACCOUNT_A}`], undefined);
});

void test("a restart then another rejected read raises nothing", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  stop();
  await whenChainIdle();
  stop = await startAccountChain({ ...fakeDeps });
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  assert.deepEqual(raised, [ACCOUNT_A]);
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "needs-login",
  );
});

void test("a login-expired folder with two rejected reads becomes needs-login", async () => {
  await begin({}, { loggedIn: () => Promise.resolve(false) });
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "login-expired",
  );
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "needs-login",
  );
  assert.deepEqual(raised, [ACCOUNT_A]);
});

void test("a 429 between two rejected reads keeps the count", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_A, failedRead("rate-limited"));
  assert.equal((await readChainState()).accounts[ACCOUNT_A]?.rejectedReads, 1);
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "needs-login",
  );
});

void test("a limit signal does not count as a rejected read", async () => {
  await begin();
  await sessionCard("nl-limit");
  await handleUsageRead("default", rejectedRead(usage(10)));
  reads.set("default", rejectedRead(usage(10)));
  const [{ cardId, sessionId }] = made.slice(-1);
  await handleLimitSignal(cardId, sessionId, null);
  assert.equal((await readChainState()).accounts.default?.rejectedReads, 1);
  assert.deepEqual(raised, []);
});

void test("an ok read after needs-login clears the state and closes the decision once with later", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  const decisionId = (await readChainState()).decisions[
    `needs-login:${ACCOUNT_A}`
  ];
  await handleUsageRead(ACCOUNT_A, usage(10));
  const saved = await readChainState();
  assert.equal(saved.accounts[ACCOUNT_A]?.state, "available");
  assert.equal(saved.accounts[ACCOUNT_A]?.rejectedReads ?? 0, 0);
  assert.deepEqual(saved.decisions, {});
  assert.deepEqual(closed, [
    {
      decisionId,
      optionId: "later",
      note: "The account returned to the chain.",
    },
  ]);
  assert.deepEqual(store.getDecisionItem(decisionId)?.answer, {
    optionId: "later",
    note: "The account returned to the chain.",
  });
  await handleUsageRead(ACCOUNT_A, usage(10));
  assert.equal(closed.length, 1);
  assert.deepEqual(logins, []);
});

void test("a failover never selects a needs-login account", async () => {
  await begin();
  const s = await sessionCard("nl-failover");
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_B);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_B);
});

void test("answering the login decision with login starts the login of that account, and later starts nothing", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_B, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_B, rejectedRead(usage(10)));
  const { decisions } = await readChainState();
  answerDecisionItem(decisions[`needs-login:${ACCOUNT_B}`], {
    optionId: "later",
    note: null,
  });
  assert.deepEqual(logins, []);
  answerDecisionItem(decisions[`needs-login:${ACCOUNT_A}`], {
    optionId: "login",
    note: null,
  });
  assert.deepEqual(logins, [ACCOUNT_A]);
});

void test("removing a needs-login account closes its decision and drops the cause", async () => {
  await begin();
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await forgetChainAccount(ACCOUNT_A);
  assert.equal(closed.length, 1);
  assert.deepEqual((await readChainState()).decisions, {});
});

const IDENTITY_A = {
  email: `${ACCOUNT_A.slice(0, 4)}@example.com`,
  orgId: "org",
};
const IDENTITY_B = {
  email: `${ACCOUNT_B.slice(0, 4)}@example.com`,
  orgId: "org",
};

void test("an account with the home login reads shadowed-by-home at start, with no usage read", async () => {
  await begin({}, {}, IDENTITY_A);
  const saved = await readChainState();
  assert.equal(saved.accounts[ACCOUNT_A]?.state, "shadowed-by-home");
  assert.equal(saved.accounts[ACCOUNT_A]?.limitedUntil, null);
  assert.equal(saved.accounts[ACCOUNT_B], undefined);
  assert.deepEqual(readLog, []);
});

void test("rejected reads on a shadowed account raise no login decision", async () => {
  await begin({}, {}, IDENTITY_A);
  for (let i = 0; i < 3; i++) {
    await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  }
  const saved = await readChainState();
  assert.equal(saved.accounts[ACCOUNT_A]?.state, "shadowed-by-home");
  assert.equal(saved.accounts[ACCOUNT_A]?.rejectedReads, undefined);
  assert.deepEqual(raised, []);
  assert.deepEqual(saved.decisions, {});
});

void test("a full read on a shadowed account stays shadowed-by-home and arms no return timer", async () => {
  await begin({}, {}, IDENTITY_A);
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 60 * MIN)));
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "shadowed-by-home",
  );
  assert.deepEqual(
    chainTimers().filter((t) => t.key === `return:${ACCOUNT_A}`),
    [],
  );
});

void test("the home login arriving after a needs-login account closes its open decision", async () => {
  await begin({}, {}, { email: "other@example.com", orgId: "org" });
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  const decisionId = (await readChainState()).decisions[
    `needs-login:${ACCOUNT_A}`
  ];
  assert.equal(store.getDecisionItem(decisionId)?.state, "open");
  await noteHomeIdentity(IDENTITY_A);
  const saved = await readChainState();
  assert.equal(saved.accounts[ACCOUNT_A]?.state, "shadowed-by-home");
  assert.deepEqual(saved.decisions, {});
  assert.deepEqual(closed, [
    {
      decisionId,
      optionId: "later",
      note: "The account returned to the chain.",
    },
  ]);
  assert.notEqual(store.getDecisionItem(decisionId)?.state, "open");
});

void test("a failover never selects a shadowed account", async () => {
  await begin({}, {}, IDENTITY_A);
  const s = await sessionCard("shadow-failover");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_B);
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_B);
  assert.deepEqual(await requestFailover("switch-now"), {
    ok: false,
    error: "no-eligible-account",
  });
  assert.equal(getActiveAccountId(), ACCOUNT_B);
});

void test("a boot return never goes back to a shadowed account", async () => {
  await begin({}, {}, IDENTITY_A);
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_B);
  await advance(30 * MIN);
  assert.notEqual(getActiveAccountId(), ACCOUNT_A);
  assert.equal(readLog.includes(ACCOUNT_A), false);
});

void test("another home login turns a shadowed account to unknown, and the next ok read derives available", async () => {
  await begin({}, {}, IDENTITY_A);
  await noteHomeIdentity({ email: "other@example.com", orgId: "org" });
  assert.equal((await readChainState()).accounts[ACCOUNT_A]?.state, "unknown");
  await handleUsageRead(ACCOUNT_A, usage(10));
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "available",
  );
  await noteHomeIdentity(IDENTITY_A);
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "shadowed-by-home",
  );
});

void test("the home login of the other account shadows it instead", async () => {
  await begin({}, {}, IDENTITY_A);
  await noteHomeIdentity(IDENTITY_B);
  const saved = await readChainState();
  assert.equal(saved.accounts[ACCOUNT_A]?.state, "unknown");
  assert.equal(saved.accounts[ACCOUNT_B]?.state, "shadowed-by-home");
});

void test("no account is shadowed once a managed default exists", async () => {
  const managed = "55555555-5555-4555-8555-555555555555";
  await adoptManagedDefault({
    id: managed,
    email: "managed@example.com",
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: "2026-10-03T00:00:00.000Z",
    lastLoginAt: "2026-10-03T00:00:00.000Z",
  });
  try {
    await begin({}, {}, IDENTITY_A);
    await noteHomeIdentity(IDENTITY_A);
    assert.notEqual(
      (await readChainState()).accounts[ACCOUNT_A]?.state,
      "shadowed-by-home",
    );
  } finally {
    await removeAccount(managed);
    await setActiveAccount("default");
  }
});

void test("a usage read for default adds no default entry once a managed default exists", async () => {
  const managed = "55555555-5555-4555-8555-555555555555";
  await adoptManagedDefault({
    id: managed,
    email: "managed@example.com",
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: "2026-10-03T00:00:00.000Z",
    lastLoginAt: "2026-10-03T00:00:00.000Z",
  });
  try {
    await begin({}, {}, IDENTITY_A);
    await handleUsageRead("default", usage(50));
    assert.equal((await readChainState()).accounts.default, undefined);
  } finally {
    await removeAccount(managed);
    await setActiveAccount("default");
  }
});

void test("the account in use is never shadowed, even when it holds the home login", async () => {
  await begin();
  await setActiveAccount(ACCOUNT_A);
  await noteHomeIdentity(IDENTITY_A);
  assert.equal((await readChainState()).accounts[ACCOUNT_A], undefined);
});

void test("a shadowed entry that no longer matches the home login at boot goes back to unknown", async () => {
  await begin();
  stop();
  await whenChainIdle();
  await writeChainState({
    ...emptyChainState(),
    accounts: {
      [ACCOUNT_A]: {
        state: "shadowed-by-home",
        limitedUntil: null,
        buckets: [],
      },
    },
  });
  stop = await startAccountChain({ ...fakeDeps });
  assert.equal((await readChainState()).accounts[ACCOUNT_A]?.state, "unknown");
});

void test("removing a shadowed account clears its shadow, so a later read of the same id derives available", async () => {
  await begin({}, {}, IDENTITY_A);
  await forgetChainAccount(ACCOUNT_A);
  assert.equal((await readChainState()).accounts[ACCOUNT_A], undefined);
  await handleUsageRead(ACCOUNT_A, usage(10));
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "available",
  );
});

/** Read every account at its limit, the earliest reset at `BASE + 30 min`, and hold those reads. */
function holdAllLimited(): void {
  reads.set(ACCOUNT_A, usage(100, iso(BASE + 30 * MIN)));
  reads.set(ACCOUNT_B, usage(100, iso(BASE + 90 * MIN)));
  reads.set("default", usage(100, iso(BASE + 120 * MIN)));
}

/** Start the controller with every account limited and the chain exhausted. */
async function beginExhausted(): Promise<string> {
  await begin();
  await sessionCard("ex-held");
  holdAllLimited();
  for (const id of [ACCOUNT_A, ACCOUNT_B, "default"]) {
    await handleUsageRead(id, reads.get(id) as ClaudeUsageSnapshot);
  }
  return (await readChainState()).decisions.exhausted;
}

void test("an exhausted chain raises one decision with the earliest reset", async () => {
  const decisionId = await beginExhausted();
  assert.deepEqual(raisedExhausted, [iso(BASE + 30 * MIN)]);
  const item = store.getDecisionItem(decisionId);
  assert.equal(item?.state, "open");
  assert.ok(item?.question.includes(iso(BASE + 30 * MIN)));
  assert.equal(events.filter((e) => e.kind === "exhausted").length, 1);
});

void test("a second exhausted check while every account is still limited raises nothing", async () => {
  await beginExhausted();
  reads.set(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  const reading = readLog.length;
  await advance(33 * MIN);
  assert.ok(readLog.length > reading);
  assert.notEqual((await readChainState()).exhausted, null);
  assert.equal(raisedExhausted.length, 1);
  assert.deepEqual(closed, []);
});

void test("the exhausted check that finds an account usable closes the decision with wait", async () => {
  const decisionId = await beginExhausted();
  reads.set(ACCOUNT_A, usage(5));
  await advance(32 * MIN);
  const saved = await readChainState();
  assert.equal(saved.exhausted, null);
  assert.equal(saved.decisions.exhausted, undefined);
  assert.deepEqual(closed, [
    { decisionId, optionId: "wait", note: "An account is usable again." },
  ]);
  assert.equal(store.getDecisionItem(decisionId)?.answer?.optionId, "wait");
});

void test("a switch now that clears the exhausted record closes the decision", async () => {
  await begin();
  const decisionId = raiseExhaustedDecision(null);
  const state = emptyChainState();
  state.exhausted = { since: iso(BASE), earliestResetAt: null };
  state.decisions.exhausted = decisionId;
  await writeChainState(state);
  stop();
  stop = await startAccountChain(fakeDeps);
  assert.equal((await requestFailover("switch-now")).ok, true);
  assert.deepEqual(closed, [
    { decisionId, optionId: "wait", note: "An account is usable again." },
  ]);
  const saved = await readChainState();
  assert.equal(saved.exhausted, null);
  assert.equal(saved.decisions.exhausted, undefined);
});

void test("a restart of the controller with the stored decision raises none at the next exhausted check", async () => {
  await beginExhausted();
  reads.set(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  stop();
  await whenChainIdle();
  stop = await startAccountChain(fakeDeps);
  await advance(33 * MIN);
  assert.notEqual((await readChainState()).exhausted, null);
  assert.equal(raisedExhausted.length, 1);
});

void test("a chain file exhausted before the upgrade raises one decision at the next exhausted check", async () => {
  await begin();
  const state = emptyChainState();
  state.exhausted = {
    since: iso(BASE),
    earliestResetAt: iso(BASE + 30 * MIN),
  };
  await writeChainState(state);
  holdAllLimited();
  reads.set(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
  stop();
  stop = await startAccountChain(fakeDeps);
  assert.deepEqual(raisedExhausted, []);
  await advance(33 * MIN);
  assert.deepEqual(raisedExhausted, [iso(BASE + 90 * MIN)]);
  assert.equal(typeof (await readChainState()).decisions.exhausted, "string");
  assert.equal(events.filter((e) => e.kind === "exhausted").length, 0);
});

void test("answering the exhausted decision starts no login, since the user adds the account on the accounts page", async () => {
  const decisionId = await beginExhausted();
  answerDecisionItem(decisionId, { optionId: "wait", note: null });
  await beginExhausted();
  const second = (await readChainState()).decisions.exhausted;
  answerDecisionItem(second, { optionId: "add", note: null });
  assert.deepEqual(logins, []);
});

void test("a limited account that then becomes shadowed loses its return timer and is never read or returned to", async () => {
  await begin({}, {}, { email: "other@example.com", orgId: "org" });
  await handleUsageRead(ACCOUNT_A, usage(100, iso(BASE + 60 * MIN)));
  assert.ok(chainTimers().some((t) => t.key === `return:${ACCOUNT_A}`));
  await noteHomeIdentity(IDENTITY_A);
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "shadowed-by-home",
  );
  assert.equal(
    chainTimers().some((t) => t.key === `return:${ACCOUNT_A}`),
    false,
  );
  await advance(90 * MIN);
  assert.equal(readLog.includes(ACCOUNT_A), false);
  assert.equal(getActiveAccountId(), "default");
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "shadowed-by-home",
  );
});

void test("a login decision dep that throws leaves needs-login without a stored decision, and the next rejected read raises one", async () => {
  let failing = true;
  await begin(
    {},
    {
      raiseLoginDecision: (accountId: string) => {
        if (failing) throw new Error("raise failed");
        return fakeDeps.raiseLoginDecision(accountId);
      },
    },
  );
  const warn = mock.method(console, "warn", () => undefined);
  try {
    await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
    await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
    const saved = await readChainState();
    assert.equal(saved.accounts[ACCOUNT_A]?.state, "needs-login");
    assert.equal(saved.decisions[`needs-login:${ACCOUNT_A}`], undefined);
    assert.deepEqual(raised, []);
    assert.equal(warn.mock.callCount() > 0, true);
    failing = false;
    await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
  } finally {
    warn.mock.restore();
  }
  assert.deepEqual(raised, [ACCOUNT_A]);
  assert.equal(
    typeof (await readChainState()).decisions[`needs-login:${ACCOUNT_A}`],
    "string",
  );
});

void test("an exhausted decision dep that rejects keeps the chain exhausted without a stored decision, and the next check raises one", async () => {
  let failing = true;
  await begin(
    {},
    {
      raiseExhaustedDecision: (earliestResetAt: string | null) =>
        failing
          ? Promise.reject(new Error("raise failed"))
          : fakeDeps.raiseExhaustedDecision(earliestResetAt),
    },
  );
  await sessionCard("ex-dep-held");
  holdAllLimited();
  const warn = mock.method(console, "warn", () => undefined);
  try {
    for (const id of [ACCOUNT_A, ACCOUNT_B, "default"]) {
      await handleUsageRead(id, reads.get(id) as ClaudeUsageSnapshot);
    }
    const saved = await readChainState();
    assert.notEqual(saved.exhausted, null);
    assert.equal(saved.decisions.exhausted, undefined);
    assert.deepEqual(raisedExhausted, []);
    assert.equal(warn.mock.callCount() > 0, true);
    failing = false;
    reads.set(ACCOUNT_A, usage(100, iso(BASE + 90 * MIN)));
    await advance(33 * MIN);
  } finally {
    warn.mock.restore();
  }
  assert.deepEqual(raisedExhausted, [iso(BASE + 90 * MIN)]);
  assert.equal(typeof (await readChainState()).decisions.exhausted, "string");
});

void test("answering a login decision when startLogin resolves not ok or rejects does not throw and keeps the decision answered", async () => {
  const outcomes = [
    () => Promise.resolve({ ok: false, error: "in-flight" }),
    () => Promise.reject(new Error("login failed")),
  ];
  for (const outcome of outcomes) {
    const attempts: (string | undefined)[] = [];
    await begin(
      {},
      {
        startLogin: (accountId?: string) => {
          attempts.push(accountId);
          return outcome();
        },
      },
    );
    await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
    await handleUsageRead(ACCOUNT_A, rejectedRead(usage(10)));
    const decisionId = (await readChainState()).decisions[
      `needs-login:${ACCOUNT_A}`
    ];
    const warn = mock.method(console, "warn", () => undefined);
    try {
      assert.doesNotThrow(() =>
        answerDecisionItem(decisionId, { optionId: "login", note: null }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(attempts, [ACCOUNT_A]);
      assert.equal(warn.mock.callCount(), 1);
    } finally {
      warn.mock.restore();
    }
    assert.equal(store.getDecisionItem(decisionId)?.state, "answered");
  }
});

void test("a shadowed account removed from the registry file loses its chain entry at the next home identity note", async () => {
  await begin({}, {}, IDENTITY_A);
  assert.equal(
    (await readChainState()).accounts[ACCOUNT_A]?.state,
    "shadowed-by-home",
  );
  await removeAccount(ACCOUNT_A);
  try {
    await noteHomeIdentity(IDENTITY_A);
    assert.equal((await readChainState()).accounts[ACCOUNT_A], undefined);
  } finally {
    await removeAccount(ACCOUNT_B);
    for (const [id, day] of [
      [ACCOUNT_A, "01"],
      [ACCOUNT_B, "02"],
    ]) {
      await upsertAccount({
        id,
        email: `${id.slice(0, 4)}@example.com`,
        orgId: "org",
        orgName: "Org",
        subscriptionType: "max",
        createdAt: `2026-10-${day}T00:00:00.000Z`,
        lastLoginAt: `2026-10-${day}T00:00:00.000Z`,
      });
      fs.mkdirSync(accountDir(id), { recursive: true });
    }
  }
});

void test("a home identity noted while the chain is stopped resolves and changes nothing, and the next start shadows from the stored identity", async () => {
  await begin();
  stop();
  await whenChainIdle();
  await noteHomeIdentity(IDENTITY_B);
  assert.equal((await readChainState()).accounts[ACCOUNT_B], undefined);
  await writeDefaultIdentity(IDENTITY_A);
  stop = await startAccountChain({ ...fakeDeps });
  const saved = await readChainState();
  assert.equal(saved.accounts[ACCOUNT_A]?.state, "shadowed-by-home");
  assert.equal(saved.accounts[ACCOUNT_B], undefined);
});
