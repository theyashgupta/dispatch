import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, NewBoard } from "../../shared/types.js";

isolateEnv();
const { BOARD_DB_PATH } = await import("./board-db.js");
const raw = new DatabaseSync(BOARD_DB_PATH);
const { store } = await import("./board.store.js");
await store.load();
raw
  .prepare("INSERT INTO cards (id, data, board_key) VALUES (?, ?, 'LOCAL')")
  .run(
    "linear-uuid-7",
    JSON.stringify({
      id: "linear-uuid-7",
      issueId: "linear-uuid-7",
      identifier: "ENG-7",
      title: "linear card",
      description: null,
      priority: 0,
      column: "todo",
      updatedAt: "2026-10-06T00:00:00.000Z",
      source: "linear",
      boardKey: "LOCAL",
    }),
  );
raw
  .prepare(
    "INSERT INTO archive (id, data, archived_at, board_key) VALUES ('OPS-3', ?, '2026-10-06T00:00:00.000Z', 'LOCAL')",
  )
  .run(JSON.stringify({ id: "OPS-3", card: { id: "OPS-3" } }));
await store.load();

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

const acmeInput: NewBoard = {
  key: key("ACME"),
  name: "Acme",
  workspaceRoot: "/acme/sessions",
  repositories: [
    { path: "/acme/api", baseBranch: "main", checkCommand: "npm run check" },
  ],
  linearTeamKeys: ["AC"],
};

void test("the migrated store holds the default board with the supervisor off", () => {
  const local = store.getBoard(DEFAULT_BOARD_KEY);
  assert.equal(local?.name, "Local");
  assert.equal(local?.workspaceRoot, null);
  assert.equal(local?.policy.supervisor, "off");
  assert.equal(local?.archived, false);
});

void test("a new board persists across a reload with the D-6 defaults and the supervisor on", async () => {
  const created = await store.createBoard(acmeInput);
  assert.equal(created.ok, true);
  await store.load();
  const acme = store.getBoard(key("ACME"));
  assert.equal(acme?.name, "Acme");
  assert.deepEqual(acme?.repositories, acmeInput.repositories);
  assert.deepEqual(acme?.linearTeamKeys, ["AC"]);
  assert.equal(acme?.policy.supervisor, "on");
  assert.equal(acme?.policy.concurrencyCap, 3);
  assert.equal(acme?.lastUsedFolder, null);
  assert.deepEqual(
    store.listBoards().map((b) => b.key),
    ["LOCAL", "ACME"],
  );
});

void test("createBoard refuses each key that D-2 forbids and leaves the list unchanged", async () => {
  const before = store.listBoards().map((b) => b.key);
  const attempt = (k: string) =>
    store.createBoard({ ...acmeInput, key: k as BoardKey, name: k });
  for (const bad of ["ab", "A", "ABCDEFG", "1AB", "A-B"]) {
    assert.deepEqual(await attempt(bad), { ok: false, reason: "invalid-key" });
  }
  for (const reserved of ["LOCAL", "GROUP"]) {
    assert.deepEqual(await attempt(reserved), {
      ok: false,
      reason: "reserved-key",
    });
  }
  assert.deepEqual(await attempt("ACME"), {
    ok: false,
    reason: "duplicate-key",
    boardName: "Acme",
  });
  assert.deepEqual(await attempt("ENG"), {
    ok: false,
    reason: "key-in-use",
    source: "linear",
  });
  assert.deepEqual(await attempt("OPS"), {
    ok: false,
    reason: "key-in-use",
    source: "archive",
  });
  assert.deepEqual(
    store.listBoards().map((b) => b.key),
    before,
  );
});

void test("updateBoard changes the fields and keeps the key", async () => {
  const updated = await store.updateBoard(key("ACME"), {
    name: "Acme Corp",
    repositories: [
      { path: "/acme/web", baseBranch: "develop", checkCommand: "make test" },
    ],
  });
  assert.equal(updated?.key, "ACME");
  assert.equal(updated?.name, "Acme Corp");
  assert.equal(updated?.workspaceRoot, "/acme/sessions");
  assert.equal(updated?.repositories[0]?.path, "/acme/web");
  await store.load();
  assert.equal(store.getBoard(key("ACME"))?.name, "Acme Corp");
});

void test("updateBoard on LOCAL keeps the folders where they live and changes the name", async () => {
  const updated = await store.updateBoard(DEFAULT_BOARD_KEY, {
    name: "Dispatch",
    workspaceRoot: "/elsewhere",
    repositories: [
      { path: "/elsewhere/repo", baseBranch: "main", checkCommand: "x" },
    ],
  });
  assert.equal(updated?.name, "Dispatch");
  assert.equal(updated?.workspaceRoot, null);
  assert.deepEqual(updated?.repositories, []);
});

void test("updateBoard of an unknown board returns undefined", async () => {
  assert.equal(await store.updateBoard(key("NOPE"), { name: "x" }), undefined);
});

void test("a board archives and restores, LOCAL and an unknown key are refused", async () => {
  assert.equal((await store.setBoardArchived(key("ACME"), true)).ok, true);
  await store.load();
  assert.equal(store.getBoard(key("ACME"))?.archived, true);
  assert.equal((await store.setBoardArchived(key("ACME"), false)).ok, true);
  assert.equal(store.getBoard(key("ACME"))?.archived, false);
  assert.deepEqual(await store.setBoardArchived(DEFAULT_BOARD_KEY, true), {
    ok: false,
    reason: "default-board",
  });
  assert.equal(store.getBoard(DEFAULT_BOARD_KEY)?.archived, false);
  assert.deepEqual(await store.setBoardArchived(key("NOPE"), true), {
    ok: false,
    reason: "unknown-board",
  });
});

void test("updateBoard copies only the four patch fields and skips unset values", async () => {
  const before = store.getBoard(key("ACME"));
  assert.ok(before);
  const policy = before.policy;
  const forged = {
    name: undefined,
    key: "KEYQ",
    archived: true,
    policy: { supervisor: "off" },
    lastUsedFolder: "/x",
  } as unknown as Parameters<typeof store.updateBoard>[1];
  await store.updateBoard(key("ACME"), forged);
  const after = store.getBoard(key("ACME"));
  assert.equal(after?.key, "ACME");
  assert.equal(after?.name, "Acme Corp");
  assert.equal(after?.archived, false);
  assert.equal(after?.policy, policy);
  assert.equal(after?.lastUsedFolder, null);
  const card = await store.createLocalCard(
    DEFAULT_BOARD_KEY,
    "saves still work",
    "",
  );
  await store.load();
  assert.ok(store.getCard(card.id), "the card persisted after the patch");
  assert.equal(store.getBoard(key("KEYQ")), undefined);
});
