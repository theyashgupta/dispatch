import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { BoardKey, Card } from "../../shared/types.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../shared/board-key.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import { startedGroup } from "../test-support/group-fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { cardsRouter } = await import("./cards.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

const ACME = key("ACME");
const BETA = key("BETA");
const LOCAL = DEFAULT_BOARD_KEY;
const TOKEN = "hook-token-must-not-leak";

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
for (const board of [ACME, BETA]) {
  await store.createBoard({
    key: board,
    name: board,
    workspaceRoot: "/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
}
await store.setBoardArchived(BETA, true);

const app = express();
app.use("/api", express.json(), cardsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

interface Listed {
  cards: Card[];
  total: number;
}

async function list(query: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}/cards${query}`);
  return { status: res.status, text: await res.text() };
}

async function listed(query: string): Promise<Listed> {
  const got = await list(query);
  assert.equal(got.status, 200, got.text);
  return JSON.parse(got.text) as Listed;
}

function ids(result: Listed): string[] {
  return result.cards.map((c) => c.id).sort();
}

const localTodo = await store.createLocalCard(LOCAL, "local todo", "");
const acmeTodo = await store.createLocalCard(ACME, "acme todo", "");
const acmeInbox = await store.createLocalCard(ACME, "acme inbox", "");
await store.moveCardManual(acmeInbox.id, "inbox");
const acmeLive = await startedGroup(store, { board: ACME });
const localLive = await startedGroup(store);
await store.mintHookChannel(acmeLive.g.id, TOKEN);
assert.equal(store.getCard(acmeLive.g.id)?.hookToken, TOKEN);
await store.applyIssues([issue("lin-1")], new Date().toISOString(), {
  source: "linear",
});

test("with no board the list holds the LOCAL cards only, and board=ACME holds the ACME cards only", async () => {
  const local = await listed("");
  assert.ok(local.cards.length > 0);
  assert.ok(local.cards.every((c) => (c.boardKey ?? "LOCAL") === "LOCAL"));
  assert.ok(ids(local).includes(localTodo.id));
  assert.equal(local.total, local.cards.length);
  assert.deepEqual(await listed("?board=LOCAL"), local);

  const acme = await listed("?board=ACME");
  assert.ok(acme.cards.every((c) => c.boardKey === "ACME"));
  assert.deepEqual(
    ids(acme),
    [
      acmeTodo.id,
      acmeInbox.id,
      acmeLive.g.id,
      acmeLive.a.id,
      acmeLive.b.id,
    ].sort(),
  );
  assert.equal(acme.total, 5);
});

test("column, source and hasSession filter the board and combine", async () => {
  assert.deepEqual(ids(await listed("?board=ACME&column=todo")), [acmeTodo.id]);
  assert.deepEqual(ids(await listed("?board=ACME&column=inbox")), [
    acmeInbox.id,
  ]);
  assert.deepEqual(ids(await listed("?board=ACME&source=group")), [
    acmeLive.g.id,
  ]);
  assert.deepEqual(ids(await listed("?board=ACME&source=local&column=todo")), [
    acmeTodo.id,
  ]);
  assert.deepEqual(ids(await listed("?board=ACME&hasSession=true")), [
    acmeLive.g.id,
  ]);
  const without = await listed("?board=ACME&hasSession=false");
  assert.ok(!ids(without).includes(acmeLive.g.id));
  assert.equal(without.total, 4);
  assert.deepEqual(ids(await listed("?source=linear")), ["lin-1"]);
  assert.deepEqual(ids(await listed("?board=ACME&source=linear")), []);
  const localSessions = await listed("?hasSession=true");
  assert.deepEqual(ids(localSessions), [localLive.g.id]);
  assert.equal(localSessions.total, 1);
});

test("the list carries the snapshot redaction: no hook token and no session records", async () => {
  const got = await list("?board=ACME&hasSession=true");
  assert.ok(!got.text.includes(TOKEN));
  assert.ok(!got.text.includes("hookToken"));
  const [card] = (JSON.parse(got.text) as Listed).cards;
  assert.equal(card?.sessions, undefined);
  assert.ok((card?.sessionSummaries?.length ?? 0) > 0);
});

test("an invalid filter answers the typed 400 and a bad board answers its own refusal", async () => {
  const cases: [string, number, string][] = [
    ["?column=bogus", 400, "invalid column"],
    ["?column=todo&column=done", 400, "invalid column"],
    ["?source=", 400, "invalid source"],
    ["?source=a&source=b", 400, "invalid source"],
    ["?hasSession=yes", 400, "invalid hasSession"],
    ["?hasSession=true&hasSession=false", 400, "invalid hasSession"],
  ];
  for (const [query, status, code] of cases) {
    const got = await list(query);
    assert.equal(got.status, status, query);
    assert.match(got.text, new RegExp(`"error":"${code}`), query);
  }
  const unknown = await list("?board=NOPE");
  assert.equal(unknown.status, 404);
  assert.equal(
    unknown.text,
    '{"error":"unknown-board","code":"unknown-board"}',
  );
  const malformed = await list("?board=bad!");
  assert.equal(malformed.status, 400);
  assert.equal(
    malformed.text,
    '{"error":"invalid-board","code":"invalid-board"}',
  );
});

test("an archived board still lists its cards", async () => {
  const beta = await listed("?board=BETA");
  assert.deepEqual(beta, { cards: [], total: 0 });
});
