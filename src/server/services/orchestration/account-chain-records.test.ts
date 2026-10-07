import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type {
  AccountEventType,
  ClaudeUsageSnapshot,
} from "../../../shared/types.js";
import {
  buildChainReason,
  parseChainReason,
} from "../../../shared/account-chain.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { installFakeTmux } from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
installFakeTmux(env);
const { store } = await import("../../store/board.store.js");
const accounts = await import("./claude-accounts.js");
const chain = await import("./account-chain.js");
const state = await import("./account-chain-state.js");
const { recordChainEvent } = await import("./account-chain-records.js");
const { setOrchestrationConfig, updateClaudeAccountsSettings } =
  await import("../infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "", port: 4700 });

const ID_A = "11111111-1111-4111-8111-111111111111";
await accounts.upsertAccount({
  id: ID_A,
  email: "work@example.com",
  orgId: "org",
  orgName: "Org",
  subscriptionType: "max",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastLoginAt: "2026-10-01T00:00:00.000Z",
});
fs.mkdirSync(accounts.accountDir(ID_A), { recursive: true });
await store.load();

const BASE = Date.parse("2026-10-06T10:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const usage = (percent: number): ClaudeUsageSnapshot => ({
  status: "ok",
  fetchedAt: iso(BASE),
  windows: [
    {
      kind: "session",
      label: "Session",
      percent,
      resetsAt: iso(BASE + 3_600_000),
      isActive: true,
      periodStart: null,
      periodEnd: null,
    },
  ],
});

interface Recorded {
  type: AccountEventType;
  reason: string;
}
interface Notice {
  title: string;
  body: string;
  url: string;
}
const recorded: Recorded[] = [];
const notices: Notice[] = [];
const fakeRecord = {
  label: (id: string) =>
    Promise.resolve(id === "default" ? "Default" : "work@example.com"),
  record: (type: AccountEventType, reason: string) => {
    recorded.push({ type, reason });
    return Promise.resolve();
  },
  notify: (notice: Notice) => {
    notices.push(notice);
    return Promise.resolve();
  },
};

let clock = BASE;
const reads = new Map<string, ClaudeUsageSnapshot>();
let due: { at: number; run: () => void }[] = [];
const sink = (event: Parameters<typeof recordChainEvent>[0]) =>
  recordChainEvent(event, fakeRecord);
const emitted: Promise<void>[] = [];
const deps = {
  now: () => clock,
  setTimer: (run: () => void, ms: number) => {
    const timer = { at: clock + ms, run };
    due.push(timer);
    return timer;
  },
  clearTimer: (handle: unknown) => {
    due = due.filter((t) => t !== handle);
  },
  refreshUsage: (id: string) =>
    Promise.resolve({ ...(reads.get(id) ?? usage(10)), fetchedAt: iso(clock) }),
  cachedUsage: (id: string) => reads.get(id) ?? usage(10),
  loggedIn: () => Promise.resolve(true),
  emit: (event: Parameters<typeof recordChainEvent>[0]) => {
    emitted.push(sink(event));
  },
  scanMs: 0,
};

async function begin(autoMove: boolean) {
  await state.writeChainState(state.emptyChainState());
  await accounts.setActiveAccount("default");
  updateClaudeAccountsSettings({
    autoMove,
    thresholdPercent: 100,
    minDwellMinutes: 0,
  });
  recorded.length = 0;
  notices.length = 0;
  emitted.length = 0;
  due = [];
  clock = BASE;
  return chain.startAccountChain(deps);
}

async function settle(): Promise<void> {
  await chain.whenChainIdle();
  await Promise.all(emitted);
}

void test.after(() => env.cleanup());

void test("a failover adds one account_failover event and one push", async () => {
  const stop = await begin(true);
  await chain.handleUsageRead("default", usage(100));
  await settle();
  stop();
  assert.deepEqual(recorded, [
    {
      type: "account_failover",
      reason: buildChainReason({
        trigger: "usage",
        from: "Default",
        to: "work@example.com",
        sessions: 0,
      }),
    },
  ]);
  assert.deepEqual(notices, [
    {
      title: "Claude account moved",
      body: "Moved 0 sessions from Default to work@example.com at a usage limit",
      url: "/#/accounts",
    },
  ]);
});

void test("an offer held back by autoMove false records and notifies once", async () => {
  const stop = await begin(false);
  await chain.handleUsageRead("default", usage(100));
  await chain.handleUsageRead("default", usage(100));
  await settle();
  stop();
  assert.deepEqual(recorded, [
    {
      type: "account_failover",
      reason: buildChainReason({
        trigger: "held",
        from: "Default",
        to: "work@example.com",
        sessions: 0,
      }),
    },
  ]);
  assert.equal(notices.length, 1);
  assert.equal(
    notices[0]?.body,
    "Default is at its usage limit; sessions can move to work@example.com",
  );
  assert.equal(accounts.getActiveAccountId(), "default");
});

void test("a return adds one account_return event and one push", async () => {
  const stop = await begin(true);
  await chain.handleUsageRead("default", usage(100));
  await settle();
  recorded.length = 0;
  notices.length = 0;
  clock = BASE + 3_720_000;
  reads.set("default", usage(0));
  for (const timer of [...due]) timer.run();
  await settle();
  stop();
  assert.deepEqual(recorded, [
    {
      type: "account_return",
      reason: buildChainReason({
        trigger: "reset",
        from: "work@example.com",
        to: "Default",
        sessions: 0,
      }),
    },
  ]);
  assert.equal(notices.length, 1);
  assert.equal(
    notices[0]?.body,
    "Returned 0 sessions to Default after its reset",
  );
});

void test("an exhausted chain adds one account_chain_exhausted event per run", async () => {
  const stop = await begin(true);
  reads.set("default", usage(100));
  await chain.handleUsageRead(ID_A, usage(100));
  await chain.handleUsageRead("default", usage(100));
  await chain.handleUsageRead("default", usage(100));
  await settle();
  stop();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.type, "account_chain_exhausted");
  assert.equal(recorded[0]?.reason, iso(BASE + 3_600_000));
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.title, "Every Claude account is at its limit");
});

void test("recordChainEvent names an exhausted chain with no known reset", async () => {
  recorded.length = 0;
  notices.length = 0;
  await recordChainEvent(
    { kind: "exhausted", from: "default", earliestResetAt: null },
    fakeRecord,
  );
  assert.deepEqual(recorded, [{ type: "account_chain_exhausted", reason: "" }]);
  assert.equal(notices[0]?.body, "The earliest reset is unknown");
});

void test("a Switch now move is recorded and notified as a manual switch", async () => {
  recorded.length = 0;
  notices.length = 0;
  await recordChainEvent(
    {
      kind: "failover",
      from: "default",
      to: ID_A,
      reason: "switch-now",
      moved: true,
      sessions: 1,
    },
    fakeRecord,
  );
  assert.equal(
    parseChainReason(recorded[0]?.reason ?? null)?.trigger,
    "switch-now",
  );
  assert.equal(
    notices[0]?.body,
    "Moved 1 session from Default to work@example.com on Switch now",
  );
});

void test("a move after the reset of an exhausted chain is recorded and notified as a reset with its session count", async () => {
  recorded.length = 0;
  notices.length = 0;
  await recordChainEvent(
    {
      kind: "failover",
      from: "default",
      to: ID_A,
      reason: "reset",
      moved: true,
      sessions: 3,
    },
    fakeRecord,
  );
  assert.deepEqual(recorded, [
    {
      type: "account_failover",
      reason: buildChainReason({
        trigger: "reset",
        from: "Default",
        to: "work@example.com",
        sessions: 3,
      }),
    },
  ]);
  assert.equal(
    notices[0]?.body,
    "Moved 3 sessions from Default to work@example.com after a reset",
  );
});

void test("each failover trigger names its cause in the record and the push", async () => {
  const cases: [string, string, string][] = [
    ["usage at the threshold", "usage", "at a usage limit"],
    ["limit surface", "surface", "at a limit surface"],
    ["rate limit stop", "rate-limit", "at a rate limit"],
  ];
  for (const [reason, trigger, cause] of cases) {
    recorded.length = 0;
    notices.length = 0;
    await recordChainEvent(
      {
        kind: "failover",
        from: "default",
        to: ID_A,
        reason,
        moved: true,
        sessions: 2,
      },
      fakeRecord,
    );
    assert.equal(
      parseChainReason(recorded[0]?.reason ?? null)?.trigger,
      trigger,
    );
    assert.equal(
      notices[0]?.body,
      `Moved 2 sessions from Default to work@example.com ${cause}`,
    );
  }
});

void test("a failed push never hides the event", async () => {
  recorded.length = 0;
  await recordChainEvent(
    {
      kind: "return",
      from: ID_A,
      to: "default",
      reason: "reset",
      moved: true,
      sessions: 1,
    },
    {
      ...fakeRecord,
      notify: () => Promise.reject(new Error("push down")),
    },
  );
  assert.equal(recorded.length, 1);
});

void test("the default sink writes the activity row to the board with the account labels", async () => {
  await recordChainEvent({
    kind: "failover",
    from: "default",
    to: ID_A,
    reason: "limit surface",
    moved: true,
    sessions: 2,
  });
  const row = store
    .listEvents(DEFAULT_BOARD_KEY, null, 10)
    .find((e) => (e.type as string) === "account_failover");
  assert.deepEqual(parseChainReason(row?.reason ?? null), {
    trigger: "surface",
    from: "Default",
    to: "work@example.com",
    sessions: 2,
  });
  assert.equal(row?.source, "accounts");
  assert.equal(row?.cardId, null);
});
