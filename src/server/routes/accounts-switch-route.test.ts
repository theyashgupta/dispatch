import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { isolateEnv } from "../test-support/fixtures.js";
import { BUSY_PANE, installFakeTmux } from "../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const fake = installFakeTmux(env);
const configHolder = await import("../services/infra/config-holder.js");
const accounts = await import("../services/orchestration/claude-accounts.js");
const { store } = await import("../store/board.store.js");
const { accountsRouter } = await import("./accounts.route.js");
const { runInChainQueue } =
  await import("../services/orchestration/account-chain.js");

configHolder.setOrchestrationConfig({ linearApiKey: "", port: 4700 });
configHolder.setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const ID_A = "11111111-1111-4111-8111-111111111111";
await accounts.upsertAccount({
  id: ID_A,
  email: "a@example.com",
  orgId: "org-a",
  orgName: "Org A",
  subscriptionType: "pro",
  createdAt: "2026-09-02T00:00:00.000Z",
  lastLoginAt: "2026-09-02T00:00:00.000Z",
});
await accounts.materializeConfigDir(ID_A);
await store.load();

const app = express();
app.use(express.json());
app.use("/api", accountsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const configPath = path.join(env.dispatchDir, "config.json");

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

async function sessionCard(title: string, pane?: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: env.root,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  if (pane !== undefined) {
    fs.writeFileSync(path.join(fake.state, `pane.dsp-${title}`), pane);
  }
  const ref = {
    cardId: created.id,
    sessionId: store.getCard(created.id)!.activeSessionId!,
  };
  made.push(ref);
  return ref;
}

const accountOf = (s: { cardId: string; sessionId: string }) =>
  store.getCard(s.cardId)?.sessions?.find((x) => x.id === s.sessionId)
    ?.claudeAccountId ?? "default";

const activePointer = () =>
  (JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>)
    .activeClaudeAccountId;

const made: { cardId: string; sessionId: string }[] = [];

void test.beforeEach(async () => {
  for (const m of made.splice(0)) {
    await store.markSessionLost(m.cardId, m.sessionId);
  }
  fake.reset();
});

void test.after(() => {
  server.close();
  env.cleanup();
});

void test("PUT /accounts/active without applyToRunning moves an idle session and queues a busy one", async () => {
  const idle = await sessionCard("sw-default-idle");
  const busy = await sessionCard("sw-default-busy", BUSY_PANE);
  const { status, body } = await call("PUT", "/accounts/active", { id: ID_A });
  assert.equal(status, 200);
  assert.deepEqual(body, {
    activeId: ID_A,
    moved: [idle],
    queued: [busy],
    skipped: [],
  });
  assert.equal(accountOf(idle), ID_A);
  assert.equal(accountOf(busy), "default");
  assert.equal(
    store.getCard(busy.cardId)?.sessions?.[0].pendingClaudeAccountId,
    ID_A,
  );
  await call("PUT", "/accounts/active", { id: "default" });
});

void test("PUT /accounts/active with none keeps the empty arrays and moves nothing", async () => {
  const idle = await sessionCard("sw-none");
  const { status, body } = await call("PUT", "/accounts/active", {
    id: ID_A,
    applyToRunning: "none",
  });
  assert.equal(status, 200);
  assert.deepEqual(body, {
    activeId: ID_A,
    moved: [],
    queued: [],
    skipped: [],
  });
  assert.equal(accountOf(idle), "default");
  assert.equal(fs.existsSync(path.join(fake.state, "calls.log")), false);
  await call("PUT", "/accounts/active", { id: "default" });
});

void test("PUT /accounts/active with an invalid applyToRunning is 400 and the pointer does not change", async () => {
  const before = activePointer();
  for (const bad of ["everything", 1, null, ""]) {
    const res = await call("PUT", "/accounts/active", {
      id: ID_A,
      applyToRunning: bad,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid-apply");
  }
  assert.equal(activePointer(), before);
});

void test("PUT /accounts/active with idle moves the idle session and reports it", async () => {
  const idle = await sessionCard("sw-idle");
  const busy = await sessionCard("sw-busy", BUSY_PANE);
  const { status, body } = await call("PUT", "/accounts/active", {
    id: ID_A,
    applyToRunning: "idle",
  });
  assert.equal(status, 200);
  assert.equal(body.activeId, ID_A);
  assert.deepEqual(body.moved, [idle]);
  assert.deepEqual(body.queued, []);
  assert.deepEqual(body.skipped, [{ ...busy, reason: "busy" }]);
  assert.equal(accountOf(idle), ID_A);
  assert.equal(accountOf(busy), "default");
});

void test("PUT /accounts/active with all queues the busy session", async () => {
  await call("PUT", "/accounts/active", { id: "default" });
  const busy = await sessionCard("sw-all-busy", BUSY_PANE);
  const { body } = await call("PUT", "/accounts/active", {
    id: ID_A,
    applyToRunning: "all",
  });
  assert.deepEqual(body.queued, [busy]);
  assert.equal(
    store.getCard(busy.cardId)?.sessions?.[0].pendingClaudeAccountId,
    ID_A,
  );
});

void test("GET /accounts lists each live session and not a lost one", async () => {
  const live = await sessionCard("sw-list", BUSY_PANE);
  const lost = await sessionCard("sw-lost");
  await store.markSessionLost(lost.cardId, lost.sessionId);
  const { status, body } = await call("GET", "/accounts");
  assert.equal(status, 200);
  const sessions = body.sessions as Record<string, unknown>[];
  assert.deepEqual(
    sessions.find((s) => s.sessionId === live.sessionId),
    {
      ...live,
      cardTitle: "sw-list",
      accountId: "default",
      turn: "busy",
      stale: false,
      pinned: false,
    },
  );
  assert.equal(
    sessions.some((s) => s.sessionId === lost.sessionId),
    false,
  );
});

void test("PUT /accounts/active with applyToRunning answers 500 when the apply throws, and the pointer has already moved", async () => {
  await call("PUT", "/accounts/active", { id: "default" });
  assert.notEqual(activePointer(), ID_A);
  const stub = mock.method(store, "clearPendingAccountsExcept", () =>
    Promise.reject(new Error("disk full")),
  );
  let res: Awaited<ReturnType<typeof call>>;
  try {
    res = await call("PUT", "/accounts/active", {
      id: ID_A,
      applyToRunning: "idle",
    });
  } finally {
    stub.mock.restore();
  }
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "accounts-apply-failed");
  assert.equal(activePointer(), ID_A);
  await call("PUT", "/accounts/active", { id: "default" });
});

void test("PUT /accounts/active waits for a chain task in flight, so a manual switch never overlaps a chain move (C-09)", async () => {
  let release: () => void = () => undefined;
  const chainTask = runInChainQueue(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  const before = activePointer();
  const put = call("PUT", "/accounts/active", { id: ID_A });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(activePointer(), before);
  release();
  await chainTask;
  const { status, body } = await put;
  assert.equal(status, 200);
  assert.equal(body.activeId, ID_A);
  await call("PUT", "/accounts/active", { id: "default" });
});
