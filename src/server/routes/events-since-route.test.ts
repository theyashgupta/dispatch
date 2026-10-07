import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { ActivityEvent, BoardKey } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { eventsRouter } = await import("./events.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
await store.load();
for (const key of [SBX, OTH]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: [],
  });
}
const a = await store.createLocalCard(SBX, "a", "");
const b = await store.createLocalCard(SBX, "b", "");
const other = await store.createLocalCard(OTH, "other", "");
await store.moveCardManual(a.id, "in_progress");
await store.moveCardManual(b.id, "in_progress");
await store.moveCardManual(other.id, "in_progress");
await store.moveCardManual(a.id, "parked");
assert.ok(store.listEvents(OTH, null, 10).length > 0);

const app = express();
app.use("/api", express.json(), eventsRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

async function events(query: string): Promise<ActivityEvent[]> {
  const res = await fetch(`${base}/events?board=SBX${query}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { events: ActivityEvent[] }).events;
}

test("no since keeps the newest-first order", async () => {
  const rows = await events("");
  assert.ok(rows.length >= 2);
  const ids = rows.map((e) => e.id);
  assert.deepEqual(
    ids,
    [...ids].sort((x, y) => y - x),
  );
});

test("since answers the later rows of the board, oldest first", async () => {
  const all = (await events("")).map((e) => e.id).sort((x, y) => x - y);
  const cut = all[0];
  const rows = await events(`&since=${cut}`);
  assert.deepEqual(
    rows.map((e) => e.id),
    all.slice(1),
  );
  assert.ok(rows.every((e) => e.boardKey === SBX));
  assert.deepEqual(await events(`&since=${all.at(-1)}`), []);
});

test("since honours limit and cardId", async () => {
  const all = (await events("")).map((e) => e.id).sort((x, y) => x - y);
  const limited = await events("&since=0&limit=1");
  assert.deepEqual(
    limited.map((e) => e.id),
    [all[0]],
  );
  const scoped = await events(`&since=0&cardId=${b.id}`);
  assert.ok(scoped.length > 0);
  assert.ok(scoped.every((e) => e.cardId === b.id));
});

test("a bad since answers 400 invalid since", async () => {
  for (const bad of ["abc", "", "-1", "1.5", "5&since=6"]) {
    const res = await fetch(`${base}/events?since=${bad}`);
    assert.equal(res.status, 400, bad);
    assert.equal(await res.text(), JSON.stringify({ error: "invalid since" }));
  }
});
