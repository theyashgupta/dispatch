import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });
const express = (await import("express")).default;
const { cardsRouter } = await import("./cards.route.js");
const { archiveRouter } = await import("./archive.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { tempRepoWithWorkspace, addWorktree } =
  await import("../test-support/git-fixtures.js");

const app = express();
app.use("/api", express.json(), cardsRouter, archiveRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function archivedGroup(opts?: Parameters<typeof startedGroup>[1]) {
  const made = await startedGroup(store, opts);
  await call("POST", `/cards/${made.g.id}/unwind`, {});
  return made;
}

test("restore answers 404 unknown archive id", async () => {
  const res = await call("POST", "/archive/GROUP-none/restore");
  assert.equal(res.status, 404);
  assert.equal(res.text, '{"error":"unknown archive id"}');
});

test("restore answers 409 with the blocker when a member moved", async () => {
  const { g, a } = await archivedGroup();
  await store.moveCardManual(a.id, "inbox");
  const res = await call("POST", `/archive/${g.id}/restore`);
  assert.equal(res.status, 409);
  assert.equal(
    res.text,
    JSON.stringify({ error: `${a.identifier} moved to inbox` }),
  );
});

test("restore answers 409 delete in progress while a delete holds the row", async () => {
  const { g } = await archivedGroup();
  store.beginCleanup(g.id);
  try {
    const res = await call("POST", `/archive/${g.id}/restore`);
    assert.equal(res.status, 409);
    assert.equal(res.text, '{"error":"delete in progress"}');
  } finally {
    store.endCleanup(g.id);
  }
});

test("delete answers 404 unknown archive id", async () => {
  for (const body of [undefined, {}, { force: true }]) {
    const res = await call("DELETE", "/archive/GROUP-none", body);
    assert.equal(res.status, 404);
    assert.equal(res.text, '{"error":"unknown archive id"}');
  }
});

test("delete answers 404 unknown archive id when the row vanishes before the final drop", async (t) => {
  const { g } = await archivedGroup();
  t.mock.method(store, "deleteArchived", () => Promise.resolve(false));
  const res = await call("DELETE", `/archive/${g.id}`, { force: true });
  assert.equal(res.status, 404);
  assert.equal(res.text, '{"error":"unknown archive id"}');
});

test("delete answers 409 back on the board with blocked false for a live group", async () => {
  const { g } = await archivedGroup();
  const row = structuredClone(store.getArchived(g.id)!);
  assert.equal((await call("POST", `/archive/${g.id}/restore`)).status, 200);
  const { openBoardDb } = await import("../store/board-db.js");
  openBoardDb().upsertArchive(row);
  try {
    const res = await call("DELETE", `/archive/${g.id}`, { force: true });
    assert.equal(res.status, 409);
    assert.equal(
      res.text,
      '{"error":"this group is back on the board","blocked":false}',
    );
  } finally {
    openBoardDb().deleteArchive(g.id);
  }
});

test("delete answers 409 in flight with blocked false while another delete holds the row", async () => {
  const { g } = await archivedGroup();
  store.beginCleanup(g.id);
  try {
    const res = await call("DELETE", `/archive/${g.id}`, { force: true });
    assert.equal(res.status, 409);
    assert.equal(
      res.text,
      '{"error":"a delete is already in flight for this group","blocked":false}',
    );
  } finally {
    store.endCleanup(g.id);
  }
});

test("delete answers 409 with the dirty reason and blocked true, and force must be boolean true", async () => {
  const { root, repo, ws } = await tempRepoWithWorkspace();
  try {
    const { g } = await startedGroup(store, {
      workspacePath: ws,
      repos: [{ path: repo, base: "main" }],
    });
    await addWorktree(repo, ws, g.id);
    await call("POST", `/cards/${g.id}/unwind`, {});
    fs.writeFileSync(path.join(ws, "repo", "wip.txt"), "unsaved");
    const expected = '{"error":"repo: 1 uncommitted change","blocked":true}';
    for (const body of [undefined, {}, { force: "true" }, { force: 1 }]) {
      const res = await call("DELETE", `/archive/${g.id}`, body);
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(res.text, expected, JSON.stringify(body));
    }
    assert.equal(fs.existsSync(path.join(ws, "repo", "wip.txt")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("delete answers 409 delete refused when the row carries no reason", async (t) => {
  const { root, repo, ws } = await tempRepoWithWorkspace();
  try {
    const { g } = await startedGroup(store, {
      workspacePath: ws,
      repos: [{ path: repo, base: "main" }],
    });
    await addWorktree(repo, ws, g.id);
    await call("POST", `/cards/${g.id}/unwind`, {});
    fs.writeFileSync(path.join(ws, "repo", "wip.txt"), "unsaved");
    const real = store.getArchived.bind(store);
    let reads = 0;
    t.mock.method(store, "getArchived", (id: string) => {
      const row = real(id);
      reads += 1;
      return reads > 1 && row ? { ...row, deleteBlocked: undefined } : row;
    });
    const res = await call("DELETE", `/archive/${g.id}`, {});
    assert.equal(res.status, 409);
    assert.equal(res.text, '{"error":"delete refused","blocked":true}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("delete answers 409 with the cleanup failure and blocked false when the workspace cannot be removed", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-archive-ro-"));
  const ws = path.join(parent, "ws");
  fs.mkdirSync(ws);
  try {
    const { g } = await archivedGroup({ workspacePath: ws });
    fs.chmodSync(parent, 0o555);
    const res = await call("DELETE", `/archive/${g.id}`, { force: true });
    assert.equal(res.status, 409);
    assert.equal(
      res.text,
      '{"error":"Cleanup incomplete: workspace folder","blocked":false}',
    );
  } finally {
    fs.chmodSync(parent, 0o755);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("unwind answers 409 ship-running while the group's ship flow runs", async () => {
  const { g } = await startedGroup(store);
  await store.setShipFlow(g.id, {
    state: "running",
    rights: "merge",
    repository: "/tmp/repo",
    repo: null,
    orchestratorId: "orc-a",
    identity: { name: "a", email: "a@example.com" },
    branches: [],
    failedStep: null,
    reason: null,
    decisionId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  const res = await call("POST", `/cards/${g.id}/unwind`, {});
  assert.equal(res.status, 409);
  assert.equal(res.text, '{"error":"ship-running"}');
  assert.ok(store.getCard(g.id));
});
