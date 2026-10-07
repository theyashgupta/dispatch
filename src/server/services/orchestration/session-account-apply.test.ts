import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import {
  BUSY_PANE,
  IDLE_PANE,
  LIMIT_PANE,
  NO_STOP_LIMIT_PANE,
  installFakeTmux,
} from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const fake = installFakeTmux(env);

const { store } = await import("../../store/board.store.js");
const { upsertAccount, accountDir } = await import("./claude-accounts.js");
const {
  applyAccountChoice,
  moveOrQueue,
  runPendingMove,
  startPendingMoveSweep,
  sweepPendingMoves,
} = await import("./session-account-apply.js");
const { applyHookEvent } = await import("./hook-events.js");
const { removeAccountAndLogout, listAccountSessions } =
  await import("./claude-account-ops.js");
const { withCardLock } = await import("./run-claude.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
for (const id of [ACCOUNT_A, ACCOUNT_B]) {
  await upsertAccount({
    id,
    email: `${id.slice(0, 4)}@example.com`,
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: "2026-10-01T00:00:00.000Z",
    lastLoginAt: "2026-10-01T00:00:00.000Z",
  });
  fs.mkdirSync(accountDir(id), { recursive: true });
}
const workspace = path.join(env.root, "ws");
fs.mkdirSync(workspace);
await store.load();

const made: { cardId: string; sessionId: string }[] = [];

/** A card whose active session runs in tmux session `dsp-<title>`, with the pane text `pane` when given. */
async function sessionCard(title: string, pane?: string, accountId?: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: workspace,
    tmuxSession: `dsp-${title}`,
    branch: title,
    claudeAccountId: accountId ?? "default",
  });
  const sessionId = store.getCard(created.id)!.activeSessionId!;
  if (pane !== undefined) {
    fs.writeFileSync(path.join(fake.state, `pane.dsp-${title}`), pane);
  }
  made.push({ cardId: created.id, sessionId });
  return { cardId: created.id, sessionId };
}

const sessionOf = (cardId: string, sessionId: string) =>
  store.getCard(cardId)?.sessions?.find((s) => s.id === sessionId);

void test.beforeEach(async () => {
  for (const m of made.splice(0)) {
    await store.markSessionLost(m.cardId, m.sessionId);
  }
  fake.reset();
});

void test.after(() => env.cleanup());

void test("idle moves the idle session and skips the busy one and the limit one with the move outcome", async () => {
  const idle = await sessionCard("ap-idle");
  const busy = await sessionCard("ap-busy", BUSY_PANE);
  const limit = await sessionCard("ap-limit", NO_STOP_LIMIT_PANE);
  const result = await applyAccountChoice("idle", ACCOUNT_A);
  assert.deepEqual(result.moved, [idle]);
  assert.deepEqual(result.queued, []);
  assert.deepEqual(result.skipped, [
    { ...busy, reason: "busy" },
    { ...limit, reason: "limit-unknown" },
  ]);
  assert.equal(
    sessionOf(idle.cardId, idle.sessionId)?.claudeAccountId,
    ACCOUNT_A,
  );
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.claudeAccountId,
    "default",
  );
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    undefined,
  );
});

void test("idle moves a session at limit surface (a) once Escape clears it (U1-06)", async () => {
  const limit = await sessionCard("ap-limit-a", LIMIT_PANE);
  fs.writeFileSync(path.join(fake.state, "next.dsp-ap-limit-a.1"), IDLE_PANE);
  const result = await applyAccountChoice("idle", ACCOUNT_A);
  assert.deepEqual(result.moved, [limit]);
  assert.deepEqual(result.skipped, []);
  assert.equal(
    sessionOf(limit.cardId, limit.sessionId)?.claudeAccountId,
    ACCOUNT_A,
  );
});

void test("all queues the busy session and sets its pending field", async () => {
  const idle = await sessionCard("ap-all-idle");
  const busy = await sessionCard("ap-all-busy", BUSY_PANE);
  const result = await applyAccountChoice("all", ACCOUNT_A);
  assert.deepEqual(result.moved, [idle]);
  assert.deepEqual(result.queued, [busy]);
  assert.deepEqual(result.skipped, []);
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_A,
  );
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.claudeAccountId,
    "default",
  );
});

void test("none touches no tmux session", async () => {
  await sessionCard("ap-none");
  assert.deepEqual(await applyAccountChoice("none", ACCOUNT_A), {
    moved: [],
    queued: [],
    skipped: [],
  });
  assert.equal(fs.existsSync(path.join(fake.state, "calls.log")), false);
});

void test("a move that returns busy under all is queued, and under idle is skipped as busy", async () => {
  const card = await sessionCard("ap-locked");
  const queued = await withCardLock(card.cardId, () =>
    applyAccountChoice("all", ACCOUNT_A),
  );
  assert.deepEqual(
    (queued as Awaited<ReturnType<typeof applyAccountChoice>>).queued,
    [card],
  );
  assert.equal(
    sessionOf(card.cardId, card.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_A,
  );
  await store.setPendingAccount(card.cardId, card.sessionId, undefined);
  const skipped = await withCardLock(card.cardId, () =>
    applyAccountChoice("idle", ACCOUNT_A),
  );
  assert.deepEqual(
    (skipped as Awaited<ReturnType<typeof applyAccountChoice>>).skipped,
    [{ ...card, reason: "busy" }],
  );
});

void test("a dead tmux session is skipped as lost, and a legacy one as legacy", async () => {
  const dead = await sessionCard("ap-dead");
  fs.writeFileSync(path.join(fake.state, "dead.dsp-ap-dead"), "");
  const result = await applyAccountChoice("idle", ACCOUNT_A);
  assert.deepEqual(result.skipped, [{ ...dead, reason: "lost" }]);
  fs.rmSync(path.join(fake.state, "dead.dsp-ap-dead"));
  fs.writeFileSync(path.join(fake.state, "legacy"), "");
  const legacy = await applyAccountChoice("all", ACCOUNT_A);
  assert.deepEqual(legacy.skipped, [{ ...dead, reason: "legacy" }]);
});

void test("moveOrQueue queues a busy session and reports queued", async () => {
  const busy = await sessionCard("mq-busy", BUSY_PANE);
  assert.equal(await moveOrQueue(busy.cardId, ACCOUNT_A), "queued");
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_A,
  );
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.claudeAccountId,
    "default",
  );
});

void test("an explicit move to another account drops the older queued target", async () => {
  const busy = await sessionCard("st-explicit", BUSY_PANE);
  assert.equal(await moveOrQueue(busy.cardId, ACCOUNT_A), "queued");
  fs.writeFileSync(path.join(fake.state, "pane.dsp-st-explicit"), IDLE_PANE);
  assert.equal(await moveOrQueue(busy.cardId, ACCOUNT_B), "moved");
  const session = sessionOf(busy.cardId, busy.sessionId);
  assert.equal(session?.claudeAccountId, ACCOUNT_B);
  assert.equal(session?.pendingClaudeAccountId, undefined);
});

void test("a pending target that changes during the move is kept", async () => {
  const card = await sessionCard("st-race");
  await store.setPendingAccount(card.cardId, card.sessionId, ACCOUNT_B);
  const original = store.setSessionAccount.bind(store);
  const stub = mock.method(
    store,
    "setSessionAccount",
    async (cardId: string, sessionId: string, accountId: string) => {
      await original(cardId, sessionId, accountId);
      await store.setPendingAccount(card.cardId, card.sessionId, "default");
    },
  );
  try {
    assert.equal(await moveOrQueue(card.cardId, ACCOUNT_A), "moved");
  } finally {
    stub.mock.restore();
  }
  assert.equal(
    sessionOf(card.cardId, card.sessionId)?.pendingClaudeAccountId,
    "default",
  );
});

void test("a same result through moveOrQueue clears a queued move", async () => {
  const card = await sessionCard("st-same", undefined, ACCOUNT_A);
  await store.setPendingAccount(card.cardId, card.sessionId, ACCOUNT_B);
  assert.equal(await moveOrQueue(card.cardId, ACCOUNT_A), "same");
  assert.equal(
    sessionOf(card.cardId, card.sessionId)?.pendingClaudeAccountId,
    undefined,
  );
});

void test("a busy or limit-unknown result keeps the queued move", async () => {
  const busy = await sessionCard("st-keep", BUSY_PANE);
  await store.setPendingAccount(busy.cardId, busy.sessionId, ACCOUNT_A);
  assert.equal(await moveOrQueue(busy.cardId, ACCOUNT_B), "queued");
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_B,
  );
  fs.writeFileSync(
    path.join(fake.state, "pane.dsp-st-keep"),
    NO_STOP_LIMIT_PANE,
  );
  assert.equal(await moveOrQueue(busy.cardId, ACCOUNT_A), "limit-unknown");
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_B,
  );
});

void test("an unknown account on a busy card is refused as account and never queued", async () => {
  const busy = await sessionCard("st-unknown", BUSY_PANE);
  assert.equal(
    await moveOrQueue(busy.cardId, "33333333-3333-4333-8333-333333333333"),
    "account",
  );
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    undefined,
  );
});

void test("applying none to B clears a queued move to A, and idle to A keeps it", async () => {
  const busy = await sessionCard("st-apply", BUSY_PANE);
  await store.setPendingAccount(busy.cardId, busy.sessionId, ACCOUNT_A);
  await applyAccountChoice("idle", ACCOUNT_A);
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_A,
  );
  assert.deepEqual(await applyAccountChoice("none", ACCOUNT_B), {
    moved: [],
    queued: [],
    skipped: [],
  });
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    undefined,
  );
});

void test("a move that throws is skipped as error and the queue still runs", async () => {
  const idle = await sessionCard("er-idle");
  const busy = await sessionCard("er-busy", BUSY_PANE);
  const stub = mock.method(store, "setSessionAccount", () =>
    Promise.reject(new Error("disk full")),
  );
  let result: Awaited<ReturnType<typeof applyAccountChoice>>;
  try {
    result = await applyAccountChoice("all", ACCOUNT_A);
  } finally {
    stub.mock.restore();
  }
  assert.deepEqual(result.moved, []);
  assert.deepEqual(result.skipped, [{ ...idle, reason: "error" }]);
  assert.deepEqual(result.queued, [busy]);
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_A,
  );
});

void test("a Stop hook runs the pending move and clears it once moved", async () => {
  const busy = await sessionCard("pm-stop", BUSY_PANE);
  await store.setPendingAccount(busy.cardId, busy.sessionId, ACCOUNT_A);
  fs.writeFileSync(
    path.join(fake.state, "pane.dsp-pm-stop"),
    "> \n? for shortcuts\n",
  );
  await applyHookEvent(busy.cardId, busy.sessionId, {
    hook_event_name: "Stop",
  });
  for (let i = 0; i < 100; i++) {
    if (
      sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId ===
      undefined
    )
      break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const session = sessionOf(busy.cardId, busy.sessionId);
  assert.equal(session?.pendingClaudeAccountId, undefined);
  assert.equal(session?.claudeAccountId, ACCOUNT_A);
});

void test("the pending move stays while the pane is busy and while the session sits at a limit", async () => {
  const busy = await sessionCard("pm-keep", BUSY_PANE);
  await store.setPendingAccount(busy.cardId, busy.sessionId, ACCOUNT_A);
  await runPendingMove(busy.cardId, busy.sessionId);
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_A,
  );
  fs.writeFileSync(
    path.join(fake.state, "pane.dsp-pm-keep"),
    NO_STOP_LIMIT_PANE,
  );
  await runPendingMove(busy.cardId, busy.sessionId);
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_A,
  );
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.claudeAccountId,
    "default",
  );
});

void test("the sweep runs the pending move once the pane is idle", async () => {
  const busy = await sessionCard("pm-sweep", BUSY_PANE);
  await store.setPendingAccount(busy.cardId, busy.sessionId, ACCOUNT_B);
  await sweepPendingMoves();
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_B,
  );
  fs.writeFileSync(
    path.join(fake.state, "pane.dsp-pm-sweep"),
    "> \n? for shortcuts\n",
  );
  await sweepPendingMoves();
  const session = sessionOf(busy.cardId, busy.sessionId);
  assert.equal(session?.pendingClaudeAccountId, undefined);
  assert.equal(session?.claudeAccountId, ACCOUNT_B);
});

void test("a pending move to the account the session already runs on clears without moving", async () => {
  const card = await sessionCard("pm-same", undefined, ACCOUNT_A);
  await store.setPendingAccount(card.cardId, card.sessionId, ACCOUNT_A);
  await runPendingMove(card.cardId, card.sessionId);
  assert.equal(
    sessionOf(card.cardId, card.sessionId)?.pendingClaudeAccountId,
    undefined,
  );
});

void test("the pending move survives a store reload", async () => {
  const busy = await sessionCard("pm-reload", BUSY_PANE);
  await store.setPendingAccount(busy.cardId, busy.sessionId, ACCOUNT_A);
  await store.load();
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_A,
  );
});

void test("removing the target account clears the pending moves that name it", async () => {
  const a = await sessionCard("pm-rm-a", BUSY_PANE);
  const b = await sessionCard("pm-rm-b", BUSY_PANE);
  await store.setPendingAccount(a.cardId, a.sessionId, ACCOUNT_A);
  await store.setPendingAccount(b.cardId, b.sessionId, ACCOUNT_B);
  assert.deepEqual(await removeAccountAndLogout(ACCOUNT_A), { ok: true });
  assert.equal(
    sessionOf(a.cardId, a.sessionId)?.pendingClaudeAccountId,
    undefined,
  );
  assert.equal(
    sessionOf(b.cardId, b.sessionId)?.pendingClaudeAccountId,
    ACCOUNT_B,
  );
});

void test("the session list shows account, turn, stale and pending, and leaves out a lost session", async () => {
  const idle = await sessionCard("ls-idle");
  const busy = await sessionCard("ls-busy", BUSY_PANE, ACCOUNT_B);
  await store.setPendingAccount(busy.cardId, busy.sessionId, "default");
  const lost = await sessionCard("ls-lost");
  await store.markSessionLost(lost.cardId, lost.sessionId);
  const list = await listAccountSessions();
  const entry = (s: { sessionId: string }) =>
    list.find((e) => e.sessionId === s.sessionId);
  assert.deepEqual(entry(idle), {
    ...idle,
    cardTitle: "ls-idle",
    accountId: "default",
    turn: "idle",
    stale: false,
    pinned: false,
  });
  assert.deepEqual(entry(busy), {
    ...busy,
    cardTitle: "ls-busy",
    accountId: ACCOUNT_B,
    turn: "busy",
    stale: false,
    pinned: false,
    pendingAccountId: "default",
  });
  assert.equal(entry(lost), undefined);
});

void test("the sweep timer runs the pending move on its own and stops when told", async () => {
  const busy = await sessionCard("pm-timer", BUSY_PANE);
  await store.setPendingAccount(busy.cardId, busy.sessionId, ACCOUNT_B);
  fs.writeFileSync(
    path.join(fake.state, "pane.dsp-pm-timer"),
    "> \n? for shortcuts\n",
  );
  const stop = startPendingMoveSweep(20);
  try {
    for (let i = 0; i < 100; i++) {
      if (
        sessionOf(busy.cardId, busy.sessionId)?.pendingClaudeAccountId ===
        undefined
      )
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    stop();
  }
  assert.equal(
    sessionOf(busy.cardId, busy.sessionId)?.claudeAccountId,
    ACCOUNT_B,
  );
});

void test("a newer pending target set during a pending move is kept", async () => {
  const card = await sessionCard("pm-race");
  await store.setPendingAccount(card.cardId, card.sessionId, ACCOUNT_B);
  const original = store.setSessionAccount.bind(store);
  const stub = mock.method(
    store,
    "setSessionAccount",
    async (cardId: string, sessionId: string, accountId: string) => {
      await original(cardId, sessionId, accountId);
      await store.setPendingAccount(card.cardId, card.sessionId, "default");
    },
  );
  try {
    await runPendingMove(card.cardId, card.sessionId);
  } finally {
    stub.mock.restore();
  }
  const session = sessionOf(card.cardId, card.sessionId);
  assert.equal(session?.claudeAccountId, ACCOUNT_B);
  assert.equal(session?.pendingClaudeAccountId, "default");
});

void test("a pending move run with nothing queued touches no tmux session", async () => {
  const card = await sessionCard("pm-none");
  await runPendingMove(card.cardId, card.sessionId);
  assert.equal(fs.existsSync(path.join(fake.state, "calls.log")), false);
  const session = sessionOf(card.cardId, card.sessionId);
  assert.equal(session?.claudeAccountId, "default");
  assert.equal(session?.pendingClaudeAccountId, undefined);
});

void test("the sweep goes on to the next session when one pending move throws", async () => {
  const first = await sessionCard("pm-throw-1");
  const second = await sessionCard("pm-throw-2");
  for (const s of [first, second]) {
    await store.setPendingAccount(s.cardId, s.sessionId, ACCOUNT_B);
  }
  const original = store.setSessionAccount.bind(store);
  let calls = 0;
  const stub = mock.method(
    store,
    "setSessionAccount",
    async (cardId: string, sessionId: string, accountId: string) => {
      calls += 1;
      if (calls === 1) throw new Error("disk full");
      await original(cardId, sessionId, accountId);
    },
  );
  const warn = mock.method(console, "warn", () => undefined);
  try {
    await sweepPendingMoves();
  } finally {
    stub.mock.restore();
    warn.mock.restore();
  }
  assert.equal(calls, 2);
  assert.equal(warn.mock.callCount(), 1);
  const accounts = [first, second].map(
    (s) => sessionOf(s.cardId, s.sessionId)?.claudeAccountId,
  );
  assert.deepEqual(accounts.sort(), [ACCOUNT_B, "default"]);
});

void test("the sweep timer runs no further sweep after it is stopped", async () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const spy = mock.method(store, "sessionsWithTmux");
  const stop = startPendingMoveSweep(20);
  try {
    for (let i = 0; i < 100 && spy.mock.callCount() === 0; i++) {
      await wait(20);
    }
    assert.ok(spy.mock.callCount() > 0, "the timer never swept");
  } finally {
    stop();
  }
  try {
    await wait(60);
    const settled = spy.mock.callCount();
    await wait(150);
    assert.equal(spy.mock.callCount(), settled);
  } finally {
    spy.mock.restore();
  }
});
