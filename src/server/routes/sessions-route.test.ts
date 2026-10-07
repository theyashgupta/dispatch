import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { BoardKey } from "../../shared/types.js";
import { parseBoardKey } from "../../shared/board-key.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { sessionsRouter } = await import("./sessions.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");

const ACME: BoardKey = (() => {
  const parsed = parseBoardKey("ACME");
  assert.ok(parsed);
  return parsed;
})();
const TOKEN = "session-token-must-not-leak";

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await store.createBoard({
  key: ACME,
  name: "Acme",
  workspaceRoot: "/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const app = express();
app.use("/api", express.json(), sessionsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

interface Entry {
  cardId: string;
  id: string;
  lost: boolean;
  active: boolean;
}

async function get(query: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}/sessions${query}`);
  return { status: res.status, text: await res.text() };
}

async function sessions(query: string): Promise<Entry[]> {
  const got = await get(query);
  assert.equal(got.status, 200, got.text);
  return (JSON.parse(got.text) as { sessions: Entry[] }).sessions;
}

function workspace(): {
  workspacePath: string;
  repos: { path: string; base: string }[];
} {
  const dir = fs.mkdtempSync(path.join(env.root, "ws-"));
  return { workspacePath: dir, repos: [{ path: dir, base: "main" }] };
}

const local = await startedGroup(store, workspace());
const acme = await startedGroup(store, { ...workspace(), board: ACME });
const acmeLost = await startedGroup(store, { ...workspace(), board: ACME });
await store.mintHookChannel(acme.g.id, TOKEN);
assert.equal(
  store.getCard(acme.g.id)?.sessions?.some((s) => s.hookToken === TOKEN),
  true,
);
await store.markSessionLost(acmeLost.g.id, undefined);

test("a session list holds the sessions of its board, each with its card id", async () => {
  const onAcme = await sessions("?board=ACME");
  assert.deepEqual(
    onAcme.map((s) => s.cardId).sort(),
    [acme.g.id, acmeLost.g.id].sort(),
  );
  const onLocal = await sessions("");
  assert.deepEqual(
    onLocal.map((s) => s.cardId),
    [local.g.id],
  );
  assert.deepEqual(await sessions("?board=LOCAL"), onLocal);
});

test("live=true keeps the sessions with a terminal and live=false the lost ones", async () => {
  assert.deepEqual(
    (await sessions("?board=ACME&live=true")).map((s) => s.cardId),
    [acme.g.id],
  );
  assert.deepEqual(
    (await sessions("?board=ACME&live=false")).map((s) => s.cardId),
    [acmeLost.g.id],
  );
  assert.deepEqual(
    (await sessions("?live=false")).map((s) => s.cardId),
    [],
  );
});

test("a session record carries no secret", async () => {
  const got = await get("?board=ACME");
  assert.ok(!got.text.includes(TOKEN));
  assert.ok(!got.text.includes("hookToken"));
});

test("an invalid live filter answers the typed 400 and a bad board answers its own refusal", async () => {
  for (const query of ["?live=yes", "?live=true&live=false", "?live="]) {
    const got = await get(query);
    assert.equal(got.status, 400, query);
    assert.equal(got.text, '{"error":"invalid live"}', query);
  }
  assert.equal((await get("?board=NOPE")).status, 404);
  assert.equal((await get("?board=bad!")).status, 400);
});

test("the API router mounts GET /sessions and scopes it by board", async () => {
  const { apiRouter } = await import("./index.js");
  const mounted = express();
  mounted.use("/api", express.json(), apiRouter);
  const s: Server = await new Promise((resolve) => {
    const l = mounted.listen(0, "127.0.0.1", () => resolve(l));
  });
  try {
    const url = `http://127.0.0.1:${(s.address() as { port: number }).port}/api`;
    const onAcme = await fetch(`${url}/sessions?board=ACME`);
    assert.equal(onAcme.status, 200);
    const body = (await onAcme.json()) as { sessions: Entry[] };
    assert.deepEqual(
      body.sessions.map((e) => e.cardId).sort(),
      [acme.g.id, acmeLost.g.id].sort(),
    );
    const onLocal = await fetch(`${url}/sessions`);
    assert.equal(onLocal.status, 200);
    assert.deepEqual(
      ((await onLocal.json()) as { sessions: Entry[] }).sessions.map(
        (e) => e.cardId,
      ),
      [local.g.id],
    );
  } finally {
    s.close();
  }
});
