import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { CONFIG_PATH } = await import("../services/infra/paths.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });
const express = (await import("express")).default;
const { cardsRouter } = await import("./cards.route.js");
const { archiveRouter } = await import("./archive.route.js");
const { boardRouter } = await import("./board.route.js");
const { openBoardDb } = await import("../store/board-db.js");
const { tempRepoWithWorkspace, addWorktree } =
  await import("../test-support/git-fixtures.js");
const fs = await import("node:fs");
const path = await import("node:path");

const app = express();
app.use("/api", express.json(), cardsRouter, archiveRouter, boardRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => server.close());

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

void test("unwind route: 404 unknown, 409 plain ticket, 400 bad destination, 409 saga in flight, 200 with a redacted summary", async () => {
  const { g, a } = await startedGroup(store);
  assert.equal(
    (await call("POST", "/cards/LOCAL-none/unwind", {})).status,
    404,
  );
  const plain = await store.createLocalCard("plain", "");
  assert.equal(
    (await call("POST", `/cards/${plain.id}/unwind`, {})).status,
    409,
  );
  assert.equal(
    (await call("POST", `/cards/${g.id}/unwind`, { to: "done" })).status,
    400,
  );
  assert.equal(
    (await call("POST", `/cards/${g.id}/unwind`, { to: null })).status,
    400,
    "an explicit null is not the default",
  );
  store.beginStart(g.id);
  assert.equal((await call("POST", `/cards/${g.id}/unwind`, {})).status, 409);
  store.endStart(g.id);
  assert.equal(store.getCard(a.id)?.groupId, g.id, "refusals changed nothing");

  const ok = await call("POST", `/cards/${a.id}/unwind`, { to: "inbox" });
  assert.equal(ok.status, 200);
  const archived = ok.json.archived as Record<string, unknown>;
  assert.equal(archived.id, g.id);
  assert.equal(archived.destination, "inbox");
  assert.equal("card" in archived, false);
  assert.ok(!JSON.stringify(ok.json).includes("hookToken"));
  assert.equal(store.getCard(a.id)?.column, "inbox");
});

void test("archive routes: list, restore (404 unknown, 409 blocked, 200), delete (404 unknown, 200)", async () => {
  const { g, a } = await startedGroup(store);
  await call("POST", `/cards/${g.id}/unwind`, {});
  const list = await call("GET", "/archive");
  assert.equal(list.status, 200);
  const rows = list.json.archived as { id: string }[];
  assert.ok(rows.some((r) => r.id === g.id));
  assert.ok(!JSON.stringify(list.json).includes('"sessions"'));

  assert.equal((await call("POST", "/archive/GROUP-none/restore")).status, 404);
  await store.moveCardManual(a.id, "inbox");
  const blocked = await call("POST", `/archive/${g.id}/restore`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, `${a.identifier} moved to inbox`);
  await store.moveCardManual(a.id, "todo");
  const restored = await call("POST", `/archive/${g.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(store.getCard(g.id)?.column, "in_progress");

  await call("POST", `/cards/${g.id}/unwind`, {});
  assert.equal((await call("DELETE", "/archive/GROUP-none", {})).status, 404);
  const deleted = await call("DELETE", `/archive/${g.id}`, {});
  assert.equal(deleted.status, 200);
  assert.equal(store.getArchived(g.id), undefined);
});

void test("archive retention config: 400 on a bad value with the file unchanged, 200 persists and reads back", async () => {
  const before = fs.existsSync(CONFIG_PATH)
    ? fs.readFileSync(CONFIG_PATH, "utf8")
    : "";
  for (const bad of [400, -1, 1.5, "30", null]) {
    const res = await call("PUT", "/config/archive-retention", {
      archiveRetentionDays: bad,
    });
    assert.equal(res.status, 400, `rejects ${String(bad)}`);
  }
  const after400 = fs.existsSync(CONFIG_PATH)
    ? fs.readFileSync(CONFIG_PATH, "utf8")
    : "";
  assert.equal(after400, before, "config untouched by refusals");

  const ok = await call("PUT", "/config/archive-retention", {
    archiveRetentionDays: 45,
  });
  assert.equal(ok.status, 200);
  assert.equal(store.getArchiveRetentionDays(), 45);
  const read = await call("GET", "/config/archive-retention");
  assert.deepEqual(read.json, { archiveRetentionDays: 45 });
  const written = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(written.archiveRetentionDays, 45);
});

void test("delete route: 409 restored for a live group, 409 busy while a delete holds the row, 409 blocked with the flag, and force must be boolean true", async () => {
  const { g } = await startedGroup(store);
  await call("POST", `/cards/${g.id}/unwind`, {});
  const row = structuredClone(store.getArchived(g.id)!);
  assert.equal((await call("POST", `/archive/${g.id}/restore`)).status, 200);
  openBoardDb().upsertArchive(row);
  const restored = await call("DELETE", `/archive/${g.id}`, { force: true });
  assert.equal(restored.status, 409);
  assert.deepEqual(restored.json, {
    error: "this group is back on the board",
    blocked: false,
  });
  openBoardDb().deleteArchive(g.id);

  const { g: g2 } = await startedGroup(store);
  await call("POST", `/cards/${g2.id}/unwind`, {});
  store.beginCleanup(g2.id);
  try {
    const busy = await call("DELETE", `/archive/${g2.id}`, { force: true });
    assert.equal(busy.status, 409);
    assert.equal(
      busy.json.error,
      "a delete is already in flight for this group",
    );
  } finally {
    store.endCleanup(g2.id);
  }

  const { root, repo, ws } = await tempRepoWithWorkspace();
  const { g: g3 } = await startedGroup(store, {
    workspacePath: ws,
    repos: [{ path: repo, base: "main" }],
  });
  await addWorktree(repo, ws, g3.id);
  await call("POST", `/cards/${g3.id}/unwind`, {});
  fs.writeFileSync(path.join(ws, "repo", "wip.txt"), "unsaved");
  const blocked = await call("DELETE", `/archive/${g3.id}`, { force: "true" });
  assert.equal(blocked.status, 409, "a string force is not force");
  assert.deepEqual(blocked.json, {
    error: "repo: 1 uncommitted change",
    blocked: true,
  });
  assert.equal(fs.existsSync(path.join(ws, "repo", "wip.txt")), true);
  const forced = await call("DELETE", `/archive/${g3.id}`, { force: true });
  assert.equal(forced.status, 200);
  assert.equal(fs.existsSync(ws), false);
  fs.rmSync(root, { recursive: true, force: true });
});
