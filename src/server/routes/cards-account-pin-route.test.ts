import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import type { ClaudeUsageSnapshot } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { IDLE_PANE, installFakeTmux } from "../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const fake = installFakeTmux(env);
const accounts = await import("../services/orchestration/claude-accounts.js");
const chain = await import("../services/orchestration/account-chain.js");
const { setHooksRuntime, setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { store } = await import("../store/board.store.js");
const { cardsRouter } = await import("./cards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
setOrchestrationConfig({ linearApiKey: "", port: 4700 });
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

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

const ok: ClaudeUsageSnapshot = {
  status: "ok",
  fetchedAt: "2026-10-06T10:00:00.000Z",
  windows: [],
};
const stop = await chain.startAccountChain({
  emit: () => undefined,
  refreshUsage: () => Promise.resolve(ok),
  cachedUsage: () => ok,
  loggedIn: () => Promise.resolve(true),
  scanMs: 0,
});

const app = express();
app.use("/api", express.json(), cardsRouter, httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;

async function put(id: string, body: unknown) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/cards/${id}/session/account-pin`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function liveCard(title: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: env.root,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  fs.writeFileSync(path.join(fake.state, `pane.dsp-${title}`), IDLE_PANE);
  const sessionId = store.getCard(created.id)!.activeSessionId!;
  return { cardId: created.id, sessionId };
}

const sessionOf = (ref: { cardId: string; sessionId: string }) =>
  store.getCard(ref.cardId)?.sessions?.find((s) => s.id === ref.sessionId);

void test.beforeEach(() => fake.reset());
void test.after(async () => {
  stop();
  await chain.whenChainIdle();
  server.close();
  env.cleanup();
});

void test("pinning and unpinning a session answers 200 with the flag and stores it", async () => {
  const ref = await liveCard("pin-ok");
  const pinned = await put(ref.cardId, {
    sessionId: ref.sessionId,
    pinned: true,
  });
  assert.deepEqual([pinned.status, pinned.body], [200, { pinned: true }]);
  assert.equal(sessionOf(ref)?.accountPinned, true);
  const unpinned = await put(ref.cardId, {
    sessionId: ref.sessionId,
    pinned: false,
  });
  assert.deepEqual([unpinned.status, unpinned.body], [200, { pinned: false }]);
  assert.equal(sessionOf(ref)?.accountPinned, undefined);
});

void test("an unknown card is 404 and a session id not on the card is 400", async () => {
  const ref = await liveCard("pin-bad");
  const other = await liveCard("pin-other");
  const noCard = await put("no-such-card", {
    sessionId: ref.sessionId,
    pinned: true,
  });
  assert.deepEqual([noCard.status, noCard.body], [404, { error: "not-found" }]);
  const foreign = await put(ref.cardId, {
    sessionId: other.sessionId,
    pinned: true,
  });
  assert.equal(foreign.status, 400);
  assert.equal(sessionOf(other)?.accountPinned, undefined);
  assert.equal(sessionOf(ref)?.accountPinned, undefined);
});

void test("a malformed body is 400", async () => {
  const ref = await liveCard("pin-malformed");
  assert.equal((await put(ref.cardId, {})).status, 400);
  assert.equal(
    (await put(ref.cardId, { sessionId: ref.sessionId })).status,
    400,
  );
  assert.equal(
    (await put(ref.cardId, { sessionId: ref.sessionId, pinned: "yes" })).status,
    400,
  );
  assert.equal(
    (await put(ref.cardId, { sessionId: "", pinned: true })).status,
    400,
  );
});

void test("requestFailover skips a pinned session and moves an unpinned one", async () => {
  await accounts.setActiveAccount("default");
  const pinned = await liveCard("pin-failover");
  const free = await liveCard("pin-free");
  await put(pinned.cardId, { sessionId: pinned.sessionId, pinned: true });
  const result = await chain.requestFailover("switch-now");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.to, ID_A);
  assert.deepEqual(
    result.moves.skipped.filter((r) => r.reason === "pinned"),
    [{ ...pinned, reason: "pinned" }],
  );
  assert.ok(result.moves.moved.some((r) => r.sessionId === free.sessionId));
  assert.ok(!result.moves.moved.some((r) => r.sessionId === pinned.sessionId));
  assert.equal(sessionOf(pinned)?.claudeAccountId, undefined);
  assert.equal(sessionOf(free)?.claudeAccountId, ID_A);
});
