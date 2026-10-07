import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { ClaudeUsageSnapshot } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { installFakeTmux } from "../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

process.env.DISPATCH_USAGE_URL = "http://127.0.0.1:1/usage";
const env = isolateEnv();
installFakeTmux(env);
const configHolder = await import("../services/infra/config-holder.js");
const accounts = await import("../services/orchestration/claude-accounts.js");
const { store } = await import("../store/board.store.js");
const chainState =
  await import("../services/orchestration/account-chain-state.js");
const chain = await import("../services/orchestration/account-chain.js");
const { accountsRouter } = await import("./accounts.route.js");

configHolder.setOrchestrationConfig({ linearApiKey: "", port: 4700 });

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
for (const [id, day] of [
  [ID_A, "01"],
  [ID_B, "02"],
]) {
  await accounts.upsertAccount({
    id,
    email: `${id.slice(0, 4)}@example.com`,
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: `2026-10-${day}T00:00:00.000Z`,
    lastLoginAt: `2026-10-${day}T00:00:00.000Z`,
  });
  fs.mkdirSync(accounts.accountDir(id), { recursive: true });
}
await store.load();

const registryPath = path.join(
  env.dispatchDir,
  "claude-accounts",
  "accounts.json",
);
const configPath = path.join(env.dispatchDir, "config.json");
const events: unknown[] = [];

const stop = await chain.startAccountChain({
  emit: (event) => {
    events.push(event);
  },
  refreshUsage: () => Promise.resolve(usage(10)),
  cachedUsage: () => usage(10),
  loggedIn: () => Promise.resolve(true),
  scanMs: 0,
});

const app = express();
app.use(express.json());
app.use("/api", accountsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

function usage(percent: number): ClaudeUsageSnapshot {
  return {
    status: "ok",
    fetchedAt: new Date().toISOString(),
    windows: [
      {
        kind: "session",
        label: "Session",
        percent,
        resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
        isActive: true,
        periodStart: null,
        periodEnd: null,
      },
    ],
  };
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

void test.after(async () => {
  stop();
  await chain.whenChainIdle();
  server.close();
  env.cleanup();
});

void test("GET /accounts lists the accounts in chain order with chain fields, settings, exhausted record and history", async () => {
  await chain.handleUsageRead(ID_A, usage(100));
  const { status, body } = await call("GET", "/accounts");
  assert.equal(status, 200);
  const list = body.accounts as Record<string, unknown>[];
  assert.deepEqual(
    list.map((a) => [a.id, a.position, a.inUse, a.state]),
    [
      ["default", 0, true, "unknown"],
      [ID_A, 1, false, "limited"],
      [ID_B, 2, false, "unknown"],
    ],
  );
  const limited = list[1];
  assert.equal(typeof limited.limitedUntil, "string");
  assert.deepEqual(
    (limited.buckets as { kind: string; percent: number }[]).map((b) => [
      b.kind,
      b.percent,
    ]),
    [["session", 100]],
  );
  assert.equal(list[0].limitedUntil, null);
  assert.deepEqual(body.chain, {
    settings: { autoMove: false, thresholdPercent: 100, minDwellMinutes: 15 },
    exhausted: null,
    history: [],
    inUseSince: null,
  });
  assert.equal(body.activeId, "default");
  assert.ok(Array.isArray(body.sessions));
});

void test("PUT /accounts/chain/order with every id writes positions, Default included", async (t) => {
  t.after(async () => {
    await call("PUT", "/accounts/chain/order", {
      order: ["default", ID_A, ID_B],
    });
  });
  const { status, body } = await call("PUT", "/accounts/chain/order", {
    order: [ID_B, "default", ID_A],
  });
  assert.equal(status, 200);
  assert.deepEqual(body, { order: [ID_B, "default", ID_A] });
  const file = JSON.parse(read(registryPath)) as {
    version: number;
    defaultPosition: number;
    accounts: { id: string; position: number }[];
  };
  assert.equal(file.version, 2);
  assert.equal(file.defaultPosition, 1);
  assert.deepEqual(
    Object.fromEntries(file.accounts.map((a) => [a.id, a.position])),
    { [ID_B]: 0, [ID_A]: 2 },
  );
  const listed = await call("GET", "/accounts");
  assert.deepEqual(
    (listed.body.accounts as { id: string }[]).map((a) => a.id),
    [ID_B, "default", ID_A],
  );
});

void test("PUT /accounts/chain/order refuses a missing, extra, repeated or malformed list and leaves the file unchanged", async () => {
  const before = read(registryPath);
  const bad: unknown[] = [
    { order: ["default", ID_A] },
    { order: ["default", ID_A, ID_B, "33333333-3333-4333-8333-333333333333"] },
    { order: ["default", ID_A, ID_A] },
    { order: [ID_A, ID_B, "other"] },
    { order: "default" },
    { order: [1, 2, 3] },
    {},
  ];
  for (const order of bad) {
    const res = await call("PUT", "/accounts/chain/order", order);
    assert.equal(res.status, 400, JSON.stringify(order));
    assert.equal(res.body.error, "invalid-order");
    assert.equal(read(registryPath), before);
  }
});

void test("PUT /accounts/chain/settings stores a subset and returns the full settings", async (t) => {
  t.after(async () => {
    await call("PUT", "/accounts/chain/settings", {
      autoMove: false,
      thresholdPercent: 100,
      minDwellMinutes: 15,
    });
  });
  const { status, body } = await call("PUT", "/accounts/chain/settings", {
    autoMove: true,
    thresholdPercent: 90,
  });
  assert.equal(status, 200);
  assert.deepEqual(body, {
    autoMove: true,
    thresholdPercent: 90,
    minDwellMinutes: 15,
  });
  const stored = JSON.parse(read(configPath)) as { claudeAccounts: unknown };
  assert.deepEqual(stored.claudeAccounts, {
    autoMove: true,
    thresholdPercent: 90,
  });
  const edge = await call("PUT", "/accounts/chain/settings", {
    thresholdPercent: 50,
    minDwellMinutes: 240,
  });
  assert.equal(edge.status, 200);
  assert.deepEqual(edge.body, {
    autoMove: true,
    thresholdPercent: 50,
    minDwellMinutes: 240,
  });
});

void test("PUT /accounts/chain/settings refuses out of range, non integer and unknown fields and changes nothing", async () => {
  const before = read(configPath);
  const bad: unknown[] = [
    { thresholdPercent: 49 },
    { thresholdPercent: 101 },
    { thresholdPercent: 75.5 },
    { thresholdPercent: "80" },
    { minDwellMinutes: 241 },
    { minDwellMinutes: -1 },
    { minDwellMinutes: 1.5 },
    { autoMove: "yes" },
    { autoMove: true, extra: 1 },
    { thresholdPercent: 80, minDwellMinutes: 999 },
  ];
  for (const patch of bad) {
    const res = await call("PUT", "/accounts/chain/settings", patch);
    assert.equal(res.status, 400, JSON.stringify(patch));
    assert.equal(res.body.error, "invalid-settings");
    assert.equal(read(configPath), before);
  }
});

void test("POST /accounts/chain/switch-now is 409 no-eligible-account when every other account is limited", async () => {
  await chain.handleUsageRead(ID_A, usage(100));
  await chain.handleUsageRead(ID_B, usage(100));
  const res = await call("POST", "/accounts/chain/switch-now");
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "no-eligible-account" });
  assert.equal(accounts.getActiveAccountId(), "default");
});

void test("POST /accounts/chain/switch-now moves to the best other qualifying account and starts a dwell", async (t) => {
  await chainState.writeChainState(chainState.emptyChainState());
  stop();
  const restart = await chain.startAccountChain({
    emit: (event) => {
      events.push(event);
    },
    refreshUsage: () => Promise.resolve(usage(10)),
    cachedUsage: () => usage(10),
    loggedIn: () => Promise.resolve(true),
    scanMs: 0,
  });
  await chain.handleUsageRead(ID_A, usage(100));
  events.length = 0;
  t.after(async () => {
    restart();
    await accounts.setActiveAccount("default");
  });
  const res = await call("POST", "/accounts/chain/switch-now");
  assert.equal(res.status, 200);
  assert.equal(res.body.to, ID_B);
  assert.deepEqual(res.body.moves, { moved: [], queued: [], skipped: [] });
  assert.equal(accounts.getActiveAccountId(), ID_B);
  assert.equal(events.length, 1);
  const saved = await chainState.readChainState();
  assert.equal(saved.moves.at(-1)?.reason, "switch-now");
  assert.notEqual(saved.inUseSince, null);
});

void test("PUT /accounts/active marks a manual pick, so a boot after a re-pick to the chain target does not return", async (t) => {
  stop();
  const at = new Date().toISOString();
  await chainState.writeChainState({
    ...chainState.emptyChainState(),
    accounts: {
      default: { state: "available", buckets: [], limitedUntil: null },
    },
    inUseSince: at,
    moves: [
      { at, from: "default", to: ID_A, reason: "usage at the threshold" },
    ],
  });
  await accounts.setActiveAccount(ID_A);
  const boot = () =>
    chain.startAccountChain({
      emit: () => undefined,
      setTimer: () => ({}),
      clearTimer: () => undefined,
      refreshUsage: () => Promise.resolve(usage(10)),
      cachedUsage: () => usage(10),
      loggedIn: () => Promise.resolve(true),
      scanMs: 0,
    });
  let restart = await boot();
  t.after(async () => {
    restart();
    await accounts.setActiveAccount("default");
  });
  assert.ok(chain.chainTimers().some((x) => x.key === "return:default"));

  const res = await call("PUT", "/accounts/active", { id: ID_A });
  assert.equal(res.status, 200);
  await chain.whenChainIdle();
  assert.equal((await chainState.readChainState()).inUseSince, null);
  restart();
  restart = await boot();
  assert.deepEqual(chain.chainTimers(), []);
});

const DEFAULT_SETTINGS = {
  autoMove: false,
  thresholdPercent: 100,
  minDwellMinutes: 15,
};

void test("PUT /accounts/chain/settings accepts thresholdPercent 100 and minDwellMinutes 0 and stores both", async (t) => {
  t.after(async () => {
    await call("PUT", "/accounts/chain/settings", DEFAULT_SETTINGS);
  });
  const { status, body } = await call("PUT", "/accounts/chain/settings", {
    thresholdPercent: 100,
    minDwellMinutes: 0,
  });
  assert.equal(status, 200);
  assert.deepEqual(body, { ...DEFAULT_SETTINGS, minDwellMinutes: 0 });
  const stored = JSON.parse(read(configPath)) as {
    claudeAccounts: Record<string, unknown>;
  };
  assert.equal(stored.claudeAccounts.thresholdPercent, 100);
  assert.equal(stored.claudeAccounts.minDwellMinutes, 0);
});

void test("PUT /accounts/chain/settings with an empty body returns the current full settings unchanged", async () => {
  const before = read(configPath);
  const { status, body } = await call("PUT", "/accounts/chain/settings", {});
  assert.equal(status, 200);
  assert.deepEqual(body, DEFAULT_SETTINGS);
  assert.equal(read(configPath), before);
});

void test("GET /accounts returns chain.history newest first and the exhausted record from chain-state.json", async (t) => {
  t.after(async () => {
    await chainState.writeChainState(chainState.emptyChainState());
  });
  const older = {
    at: "2026-10-06T08:00:00.000Z",
    from: "default",
    to: ID_A,
    reason: "usage at the threshold",
  };
  const newer = {
    at: "2026-10-06T09:00:00.000Z",
    from: ID_A,
    to: ID_B,
    reason: "limit surface",
  };
  const exhausted = {
    since: "2026-10-06T09:30:00.000Z",
    earliestResetAt: "2026-10-06T11:00:00.000Z",
  };
  await chainState.writeChainState({
    ...chainState.emptyChainState(),
    inUseSince: newer.at,
    exhausted,
    moves: [older, newer],
  });
  const { status, body } = await call("GET", "/accounts");
  assert.equal(status, 200);
  const view = body.chain as {
    history: unknown[];
    exhausted: unknown;
    inUseSince: string;
  };
  assert.deepEqual(view.history, [newer, older]);
  assert.deepEqual(view.exhausted, exhausted);
  assert.equal(view.inUseSince, newer.at);
});

void test("GET /accounts returns pinned true only on a session whose card session has accountPinned set", async (t) => {
  const make = async (title: string) => {
    const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
    await store.completeStart(created.id, undefined, {
      workspacePath: env.root,
      tmuxSession: `dsp-${title}`,
      branch: title,
    });
    return {
      cardId: created.id,
      sessionId: store.getCard(created.id)!.activeSessionId!,
    };
  };
  const pinned = await make("pin-yes");
  const loose = await make("pin-no");
  t.after(async () => {
    await store.markSessionLost(pinned.cardId, pinned.sessionId);
    await store.markSessionLost(loose.cardId, loose.sessionId);
  });
  await store.setAccountPinned(pinned.cardId, pinned.sessionId, true);
  const { status, body } = await call("GET", "/accounts");
  assert.equal(status, 200);
  const sessions = body.sessions as {
    cardId: string;
    sessionId: string;
    pinned: boolean;
  }[];
  const entryOf = (ref: { cardId: string; sessionId: string }) =>
    sessions.find(
      (s) => s.cardId === ref.cardId && s.sessionId === ref.sessionId,
    );
  assert.equal(entryOf(pinned)?.pinned, true);
  assert.equal(entryOf(loose)?.pinned, false);
});
