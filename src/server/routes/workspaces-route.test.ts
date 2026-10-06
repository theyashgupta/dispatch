import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { WorkspacesInventory } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { ALL_BOARDS, DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { workspacesRouter } = await import("./workspaces.route.js");
const { buildInventory } =
  await import("../services/orchestration/workspace-inventory.js");
type InventoryProbes =
  import("../services/orchestration/workspace-inventory.js").InventoryProbes;

await store.load();
const app = express();
app.use("/api", workspacesRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-ws-route-"));
after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function seedWorkspaceCard(title: string, withWorkspace: boolean) {
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  const ws = path.join(root, card.id);
  if (!withWorkspace) return { id: card.id, ws };
  await store.setCardWorkspace(card.id, {
    folder: root,
    repos: [{ path: path.join(root, "repo"), base: "main" }],
  });
  fs.mkdirSync(path.join(ws, "repo"), { recursive: true });
  fs.writeFileSync(path.join(ws, "repo", "blob"), Buffer.alloc(32 * 1024));
  await store.completeStart(card.id, undefined, {
    workspacePath: ws,
    tmuxSession: `dsp-${card.id}-absent`,
    branch: card.id,
  });
  return { id: card.id, ws };
}

async function getInventory(query = ""): Promise<WorkspacesInventory> {
  const res = await fetch(`${base}/workspaces${query}`);
  assert.equal(res.status, 200);
  return (await res.json()) as WorkspacesInventory;
}

const a = await seedWorkspaceCard("first", true);
const b = await seedWorkspaceCard("second", true);
await seedWorkspaceCard("no workspace", false);

void test("GET /api/workspaces lists every session worktree with a size and sums them", async () => {
  const inv = await getInventory();
  const ids = inv.worktrees.map((w) => w.cardId).sort();
  assert.deepEqual(ids, [a.id, b.id].sort());
  for (const row of inv.worktrees) {
    assert.equal(typeof row.sizeKb, "number");
    assert.ok((row.sizeKb ?? 0) >= 32);
  }
  const sum = inv.worktrees.reduce((n, w) => n + (w.sizeKb ?? 0), 0);
  assert.equal(inv.totalKb, sum);
  assert.equal(inv.unknownSizes, 0);
});

void test("fresh=1 recomputes sizes and a deleted worktree reads as unknown, not an error", async () => {
  const before = await getInventory();
  fs.writeFileSync(path.join(a.ws, "repo", "more"), Buffer.alloc(256 * 1024));
  fs.rmSync(b.ws, { recursive: true, force: true });
  const cachedInv = await getInventory();
  assert.deepEqual(
    cachedInv.worktrees.map((w) => w.sizeKb),
    before.worktrees.map((w) => w.sizeKb),
    "a call inside the TTL serves cached sizes",
  );
  const fresh = await getInventory("?fresh=1");
  const rowA = fresh.worktrees.find((w) => w.cardId === a.id);
  const rowB = fresh.worktrees.find((w) => w.cardId === b.id);
  assert.ok((rowA?.sizeKb ?? 0) >= 256);
  assert.equal(rowB?.sizeKb, null);
  assert.equal(fresh.unknownSizes, 1);
  assert.equal(fresh.totalKb, rowA?.sizeKb);
});

void test("a fresh value other than 1 is refused with 400", async () => {
  const res = await fetch(`${base}/workspaces?fresh=yes`);
  assert.equal(res.status, 400);
});

void test("the inventory never runs more than 4 probes at once", async () => {
  for (let i = 0; i < 8; i++) await seedWorkspaceCard(`bulk ${i}`, true);
  let active = 0;
  let peak = 0;
  const probe = async <T>(value: T): Promise<T> => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return value;
  };
  const inv = await buildInventory(
    { fresh: true },
    {
      diskUsageKb: () => probe(1),
      lastCommitAt: () => probe(2),
      discoverRepos: () => probe([]),
    },
  );
  assert.ok(inv.worktrees.length >= 10);
  assert.ok(peak <= 4, `peak ${peak} exceeded 4`);
  assert.ok(peak >= 2, "the limiter still runs probes in parallel");
});

void test("building the inventory changes no card", async () => {
  const before = JSON.stringify(store.listCards(ALL_BOARDS));
  await buildInventory({ fresh: true });
  assert.equal(JSON.stringify(store.listCards(ALL_BOARDS)), before);
});

void test("a folder whose discovery throws reads as no repos and never fails the inventory", async () => {
  await store.addWorkspaceFolder(DEFAULT_BOARD_KEY, root);
  const inv = await buildInventory(
    { fresh: true },
    {
      diskUsageKb: () => Promise.resolve(1),
      lastCommitAt: () => Promise.resolve(null),
      discoverRepos: () => Promise.reject(new Error("corrupt .git")),
    },
  );
  const folder = inv.folders.find((f) => f.path === root);
  assert.deepEqual(folder?.repos, []);
  assert.ok(inv.worktrees.length > 0);
});

function countingProbes(overrides: Partial<InventoryProbes> = {}) {
  const calls = { disk: 0, commit: 0, discover: 0 };
  const probes: InventoryProbes = {
    diskUsageKb: () => {
      calls.disk++;
      return Promise.resolve(7);
    },
    lastCommitAt: () => {
      calls.commit++;
      return Promise.resolve(1000);
    },
    discoverRepos: () => {
      calls.discover++;
      return Promise.resolve([]);
    },
    ...overrides,
  };
  return { calls, probes };
}

void test("fresh=1 drops the size, commit and discovery caches; a plain build reuses all three", async () => {
  await store.addWorkspaceFolder(DEFAULT_BOARD_KEY, root);
  const { calls, probes } = countingProbes();
  await buildInventory({ fresh: true }, probes);
  const first = { ...calls };
  assert.ok(first.disk > 0 && first.commit > 0 && first.discover > 0);
  await buildInventory({ fresh: false }, probes);
  assert.deepEqual(calls, first, "a plain build inside the TTL probes nothing");
  await buildInventory({ fresh: true }, probes);
  assert.equal(calls.disk, first.disk * 2);
  assert.equal(calls.commit, first.commit * 2);
  assert.equal(calls.discover, first.discover * 2);
});

void test("an unknown size is not cached, so the next build probes it again", async () => {
  const { calls, probes } = countingProbes({
    diskUsageKb: () => {
      calls.disk++;
      return Promise.resolve(null);
    },
  });
  await buildInventory({ fresh: true }, probes);
  const first = calls.disk;
  await buildInventory({ fresh: false }, probes);
  assert.equal(calls.disk, first * 2);
});

void test("a rejected discovery is not cached, so the next build tries the folder again", async () => {
  await store.addWorkspaceFolder(DEFAULT_BOARD_KEY, root);
  let attempts = 0;
  const { probes } = countingProbes({
    discoverRepos: () => {
      attempts++;
      return attempts === 1
        ? Promise.reject(new Error("transient"))
        : Promise.resolve([{ path: "/r/app", name: "app", base: "main" }]);
    },
  });
  const failed = await buildInventory({ fresh: true }, probes);
  assert.deepEqual(failed.folders.find((f) => f.path === root)?.repos, []);
  const retried = await buildInventory({ fresh: false }, probes);
  assert.deepEqual(
    retried.folders.find((f) => f.path === root)?.repos.map((r) => r.name),
    ["app"],
  );
});

void test("the newest commit across a session's repos wins, and all-unknown reads null", async () => {
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "two repos", "");
  const ws = path.join(root, `${card.id}-multi`);
  await store.setCardWorkspace(card.id, {
    folder: root,
    repos: [
      { path: path.join(root, "alpha"), base: "main" },
      { path: path.join(root, "beta"), base: "main" },
    ],
  });
  await store.completeStart(card.id, undefined, {
    workspacePath: ws,
    tmuxSession: `dsp-${card.id}-absent`,
    branch: card.id,
  });
  const byRepo = { alpha: 5_000, beta: 9_000 };
  const { probes } = countingProbes({
    lastCommitAt: (wt) =>
      Promise.resolve(byRepo[path.basename(wt) as "alpha" | "beta"] ?? null),
  });
  const inv = await buildInventory({ fresh: true }, probes);
  assert.equal(
    inv.worktrees.find((w) => w.cardId === card.id)?.lastCommitAt,
    9_000,
  );
  const none = await buildInventory(
    { fresh: true },
    countingProbes({ lastCommitAt: () => Promise.resolve(null) }).probes,
  );
  assert.equal(
    none.worktrees.find((w) => w.cardId === card.id)?.lastCommitAt,
    null,
  );
});

void test("two sessions sharing a workspace path keep separate cache entries", async () => {
  const shared = path.join(root, "shared-ws");
  for (const title of ["share one", "share two"]) {
    const card = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
    await store.setCardWorkspace(card.id, {
      folder: root,
      repos: [{ path: path.join(root, "repo"), base: "main" }],
    });
    await store.completeStart(card.id, undefined, {
      workspacePath: shared,
      tmuxSession: `dsp-${card.id}-absent`,
      branch: card.id,
    });
  }
  const probed: string[] = [];
  const { probes } = countingProbes({
    diskUsageKb: (p) => {
      probed.push(p);
      return Promise.resolve(3);
    },
  });
  await buildInventory({ fresh: true }, probes);
  assert.equal(probed.filter((p) => p === shared).length, 2);
});

void test("a probe that throws synchronously rejects the build without leaking a slot", async () => {
  const { probes } = countingProbes({
    diskUsageKb: () => {
      throw new Error("sync boom");
    },
  });
  await assert.rejects(buildInventory({ fresh: true }, probes), /sync boom/);
  const ok = await buildInventory({ fresh: true }, countingProbes().probes);
  assert.ok(ok.worktrees.length > 0);
});
