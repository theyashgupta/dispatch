import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Item } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeItem as item } from "../test-support/fake-source.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { itemsRouter } = await import("./items.route.js");
const { boardRouter } = await import("./board.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });
await store.load();

const app = express();
app.use("/api", express.json(), itemsRouter, boardRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => server.close());

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function listIds(query = ""): Promise<string[]> {
  const res = await fetch(`${base}/items${query}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { items: Item[] }).items.map((i) => i.id);
}

await store.upsertItems(
  "fake",
  [
    item("low", { priority: 10, createdAt: "2026-09-24T08:00:00.000Z" }),
    item("high", { priority: 90 }),
    item("mid-old", { priority: 50, createdAt: "2026-09-24T07:00:00.000Z" }),
    item("mid-new", { priority: 50, createdAt: "2026-09-24T10:00:00.000Z" }),
  ],
  { kind: "snapshot" },
);
await store.upsertItems(
  "other",
  [item("o", { id: "other:o", source: "other", priority: 1 })],
  {
    kind: "append",
  },
);

test("GET /items lists every item sorted by priority then newest and honors the filters", async () => {
  assert.deepEqual(await listIds(), [
    "fake:high",
    "fake:mid-new",
    "fake:mid-old",
    "fake:low",
    "other:o",
  ]);
  assert.deepEqual(await listIds("?source=other"), ["other:o"]);
  assert.deepEqual(await listIds("?state=done"), []);
  const bad = await fetch(`${base}/items?state=bogus`);
  assert.equal(bad.status, 400);
});

test("POST /items/:id/state changes the state and refuses bad input", async () => {
  assert.equal(
    (await post("/items/fake:low/state", { state: "read" })).status,
    204,
  );
  assert.deepEqual(await listIds("?state=read"), ["fake:low"]);
  assert.equal(
    (await post("/items/fake:low/state", { state: "snoozed" })).status,
    400,
  );
  assert.equal(
    (await post("/items/fake:low/state", { state: "gone" })).status,
    400,
  );
  assert.equal((await post("/items/fake:low/state", {})).status, 400);
  assert.equal(
    (await post("/items/fake:nope/state", { state: "read" })).status,
    404,
  );
});

test("POST /items/:id/snooze accepts a future time and refuses past or malformed ones", async () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(
    (await post("/items/fake:mid-old/snooze", { until: future })).status,
    204,
  );
  assert.deepEqual(await listIds("?state=snoozed"), ["fake:mid-old"]);
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(
    (await post("/items/fake:mid-old/snooze", { until: past })).status,
    400,
  );
  assert.equal(
    (await post("/items/fake:mid-old/snooze", { until: "soon" })).status,
    400,
  );
  assert.equal((await post("/items/fake:mid-old/snooze", {})).status, 400);
  assert.equal(
    (await post("/items/fake:nope/snooze", { until: future })).status,
    404,
  );
  assert.deepEqual(await listIds("?state=snoozed"), ["fake:mid-old"]);
});

test("POST /items/:id/promote creates once, then returns the same card, and hides the item from the snapshot", async () => {
  const first = await post("/items/fake:high/promote");
  assert.equal(first.status, 201);
  const created = (
    (await first.json()) as {
      card: { id: string; column: string; hookToken?: string };
    }
  ).card;
  assert.equal(created.column, "inbox");
  assert.equal("hookToken" in created, false);
  const second = await post("/items/fake:high/promote");
  assert.equal(second.status, 200);
  assert.equal(
    ((await second.json()) as { card: { id: string } }).card.id,
    created.id,
  );
  assert.equal((await post("/items/fake:nope/promote")).status, 404);
  assert.deepEqual(await listIds("?state=done"), ["fake:high"]);
  const reopen = await post("/items/fake:high/state", { state: "unread" });
  assert.equal(reopen.status, 409);
  const snoozePromoted = await post("/items/fake:high/snooze", {
    until: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.equal(snoozePromoted.status, 409);
  assert.deepEqual(await listIds("?state=done"), ["fake:high"]);
  const snapshotItems = store.snapshot().items ?? [];
  assert.equal(
    snapshotItems.some((i) => i.id === "fake:high"),
    false,
  );
  assert.equal(
    store.snapshot().cards.filter((c) => c.id === created.id).length,
    1,
  );
});

test("route input edges: array state, non-string source, missing body and a far-future snooze all 400", async () => {
  assert.equal(
    (await fetch(`${base}/items?state=read&state=done`)).status,
    400,
  );
  assert.equal((await fetch(`${base}/items?source=a&source=b`)).status, 400);
  assert.equal(
    (await fetch(`${base}/items?state=read&source=other`)).status,
    200,
  );
  assert.equal((await post("/items/fake:low/state")).status, 400);
  assert.equal(
    (await post("/items/fake:low/snooze", { until: "99999" })).status,
    400,
  );
});

test("GET /board carries the same non-done items as the items list", async () => {
  const board = (await (await fetch(`${base}/board`)).json()) as {
    items?: Item[];
  };
  const listed = (
    (await (await fetch(`${base}/items`)).json()) as { items: Item[] }
  ).items;
  assert.ok(Array.isArray(board.items));
  assert.deepEqual(
    board.items?.map((i) => i.id),
    listed.filter((i) => i.state !== "done").map((i) => i.id),
  );
  assert.equal(
    board.items?.some((i) => i.state === "done"),
    false,
  );
});
