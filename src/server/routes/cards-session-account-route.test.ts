import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  BUSY_PANE,
  NO_STOP_LIMIT_PANE,
  installFakeTmux,
} from "../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const fake = installFakeTmux(env);
const accounts = await import("../services/orchestration/claude-accounts.js");
const { setHooksRuntime } = await import("../services/infra/config-holder.js");
const { store } = await import("../store/board.store.js");
const { cardsRouter } = await import("./cards.route.js");
const { withCardLock } =
  await import("../services/orchestration/run-claude.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_UNREGISTERED = "33333333-3333-4333-8333-333333333333";
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
app.use("/api", express.json(), cardsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;

async function post(id: string, body: unknown) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/cards/${id}/session/account`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function liveCard(title: string, pane?: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: env.root,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  if (pane !== undefined) {
    fs.writeFileSync(path.join(fake.state, `pane.dsp-${title}`), pane);
  }
  return created.id;
}

const sessionOf = (cardId: string) => store.getCard(cardId)?.sessions?.[0];

void test.beforeEach(() => fake.reset());
void test.after(() => {
  server.close();
  env.cleanup();
});

void test("an unknown card or an unregistered account is 404 not-found", async () => {
  const card = await liveCard("sa-unknown");
  const noCard = await post("no-such-card", { accountId: ID_A });
  assert.equal(noCard.status, 404);
  assert.equal(noCard.body.error, "not-found");
  const noAccount = await post(card, { accountId: ID_UNREGISTERED });
  assert.equal(noAccount.status, 404);
  assert.equal(noAccount.body.error, "not-found");
  assert.equal(sessionOf(card)?.claudeAccountId, undefined);
});

void test("an unregistered account on a card that is busy is 404, not queued", async () => {
  const card = await liveCard("sa-locked-unknown");
  const res = await withCardLock(card, () =>
    post(card, { accountId: ID_UNREGISTERED }),
  );
  const { status, body } = res as Awaited<ReturnType<typeof post>>;
  assert.deepEqual([status, body], [404, { error: "not-found" }]);
  assert.equal(sessionOf(card)?.pendingClaudeAccountId, undefined);
  const known = await withCardLock(card, () => post(card, { accountId: ID_A }));
  assert.equal((known as Awaited<ReturnType<typeof post>>).status, 202);
});

void test("an unregistered account on a card with no live session is 404, not no-session", async () => {
  const bare = await store.createLocalCard(
    DEFAULT_BOARD_KEY,
    "sa-bare-unknown",
    "",
  );
  const res = await post(bare.id, { accountId: ID_UNREGISTERED });
  assert.deepEqual([res.status, res.body], [404, { error: "not-found" }]);
});

void test("a malformed body is 400", async () => {
  const card = await liveCard("sa-bad");
  assert.equal((await post(card, {})).status, 400);
  assert.equal((await post(card, { accountId: "../etc" })).status, 400);
  assert.equal(
    (await post(card, { accountId: ID_A, sessionId: "" })).status,
    400,
  );
});

void test("an idle session moves with 200 moved, and the same account answers 200 same", async () => {
  const card = await liveCard("sa-moved");
  const moved = await post(card, { accountId: ID_A });
  assert.deepEqual([moved.status, moved.body], [200, { outcome: "moved" }]);
  assert.equal(sessionOf(card)?.claudeAccountId, ID_A);
  const same = await post(card, {
    accountId: ID_A,
    sessionId: sessionOf(card)?.id,
  });
  assert.deepEqual([same.status, same.body], [200, { outcome: "same" }]);
});

void test("a busy session is 202 queued with the pending field set and no move", async () => {
  const card = await liveCard("sa-busy", BUSY_PANE);
  const res = await post(card, { accountId: ID_A });
  assert.deepEqual([res.status, res.body], [202, { outcome: "queued" }]);
  assert.equal(sessionOf(card)?.pendingClaudeAccountId, ID_A);
  assert.equal(sessionOf(card)?.claudeAccountId, undefined);
});

void test("a legacy session, a card with no session and a session at a limit are 409 with the outcome code", async () => {
  const legacy = await liveCard("sa-legacy");
  fs.writeFileSync(path.join(fake.state, "legacy"), "");
  const l = await post(legacy, { accountId: ID_A });
  assert.deepEqual([l.status, l.body], [409, { error: "legacy" }]);

  const bare = await store.createLocalCard(DEFAULT_BOARD_KEY, "sa-bare", "");
  const n = await post(bare.id, { accountId: ID_A });
  assert.deepEqual([n.status, n.body], [409, { error: "no-session" }]);

  fake.reset();
  const limit = await liveCard("sa-limit", NO_STOP_LIMIT_PANE);
  const lim = await post(limit, { accountId: ID_A });
  assert.deepEqual([lim.status, lim.body], [409, { error: "limit-unknown" }]);
});

void test("an explicit sessionId the card does not have is 409 no-session and moves nothing", async () => {
  const card = await liveCard("sa-foreign-session");
  const res = await post(card, {
    accountId: ID_A,
    sessionId: "no-such-session",
  });
  assert.deepEqual([res.status, res.body], [409, { error: "no-session" }]);
  assert.equal(sessionOf(card)?.claudeAccountId, undefined);
  assert.equal(sessionOf(card)?.pendingClaudeAccountId, undefined);
});
