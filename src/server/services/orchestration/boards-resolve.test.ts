import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { BoardConflictError, BoardNotFoundError } =
  await import("../domain/errors.js");
const { mapBoardUnavailable, resolveBoard, resolveBoardForCreate } =
  await import("./boards.js");
after(() => env.cleanup());

const repo = path.join(env.root, "repo");
fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
await store.load();

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

await store.createBoard({
  key: key("OPEN"),
  name: "Open",
  workspaceRoot: env.root,
  repositories: [{ path: repo, baseBranch: null, checkCommand: "x" }],
  linearTeamKeys: [],
});
await store.createBoard({
  key: key("SHUT"),
  name: "Shut",
  workspaceRoot: env.root,
  repositories: [{ path: repo, baseBranch: null, checkCommand: "x" }],
  linearTeamKeys: [],
});
await store.setBoardArchived(key("SHUT"), true);

test("an absent board resolves to the default board", () => {
  assert.equal(resolveBoard(undefined).key, DEFAULT_BOARD_KEY);
  assert.equal(resolveBoardForCreate(undefined).key, DEFAULT_BOARD_KEY);
});

test("an unknown board throws the typed 404 unknown-board", () => {
  for (const resolve of [resolveBoard, resolveBoardForCreate]) {
    assert.throws(
      () => resolve(key("NOPE")),
      (err) =>
        err instanceof BoardNotFoundError &&
        err.status === 404 &&
        err.code === "unknown-board" &&
        (err.details as { code: string }).code === "unknown-board",
    );
  }
});

test("an archived board resolves for a read and throws the typed 409 board-archived for a create", () => {
  assert.equal(resolveBoard(key("SHUT")).archived, true);
  assert.throws(
    () => resolveBoardForCreate(key("SHUT")),
    (err) =>
      err instanceof BoardConflictError &&
      err.status === 409 &&
      err.code === "board-archived",
  );
  assert.equal(resolveBoardForCreate(key("OPEN")).key, "OPEN");
});

test("the resolved board is a copy of the store entry", () => {
  const board = resolveBoard(key("OPEN"));
  board.name = "Changed";
  assert.equal(store.getBoard(key("OPEN"))?.name, "Open");
});

test("a create the store refuses maps to the typed error of its cause", async () => {
  const archived = await store
    .createLocalCard(key("SHUT"), "t", "")
    .catch((err: unknown) => err);
  const archivedError = mapBoardUnavailable(archived);
  assert.ok(archivedError instanceof BoardConflictError);
  assert.equal(archivedError.code, "board-archived");

  const unknown = await store
    .createLocalCard(key("GONE"), "t", "")
    .catch((err: unknown) => err);
  const unknownError = mapBoardUnavailable(unknown);
  assert.ok(unknownError instanceof BoardNotFoundError);
  assert.equal(unknownError.code, "unknown-board");

  const other = new Error("disk");
  assert.equal(mapBoardUnavailable(other), other);
});
