import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { SWITCH_NOW_REASON } from "../../../shared/account-chain.js";
import type {
  ClaudeAccountsSettings,
  ClaudeUsageSnapshot,
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
const { upsertAccount, accountDir, getActiveAccountId, setActiveAccount } =
  await import("./claude-accounts.js");
const { emptyChainState, readChainState, writeChainState } =
  await import("./account-chain-state.js");
const {
  chainTimers,
  forgetChainAccount,
  handleLimitSignal,
  handleUsageRead,
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
  reads.clear();
  readMode = "fresh";
  clock = BASE;
  await writeChainState(emptyChainState());
  await setActiveAccount("default");
  updateClaudeAccountsSettings({
    autoMove: true,
    thresholdPercent: 100,
    minDwellMinutes: 15,
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

void test("a hook limit with no surface on screen moves the session without Continue. (C-03b)", async () => {
  await begin();
  const s = await sessionCard("hl-idle");
  recordTurnEvent(s.cardId, s.sessionId, "StopFailure", "rate_limit");
  await whenChainIdle();
  assert.equal(sessionOf(s)?.claudeAccountId, ACCOUNT_A);
  assert.equal(continued("hl-idle"), false);
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
    events.map((e) => (e.kind === "exhausted" ? null : e.sessions)),
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

void test("a read below the threshold before limitedUntil keeps the account limited, so a failover skips it", async () => {
  await begin();
  const s = await sessionCard("hd-held");
  await handleUsageRead("default", usage(100, iso(BASE + 60 * MIN)));
  assert.equal(getActiveAccountId(), ACCOUNT_A);
  await advance(5 * MIN);
  await handleUsageRead("default", usage(10));
  const saved = await readChainState();
  assert.equal(saved.accounts.default?.state, "limited");
  assert.equal(saved.accounts.default?.limitedUntil, iso(BASE + 60 * MIN));

  claudeInForeground();
  await handleLimitSignal(s.cardId, s.sessionId, null);
  assert.equal(getActiveAccountId(), ACCOUNT_B);
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
