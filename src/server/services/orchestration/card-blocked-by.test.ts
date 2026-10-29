import test, { after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, Card } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { DISPATCH_DATA_DIR } = await import("../../store/data-dir.js");
assert.notEqual(
  path.resolve(DISPATCH_DATA_DIR),
  path.join(os.userInfo().homedir, ".dispatch"),
  "test bound to the live board.db",
);
const { store } = await import("../../store/board.store.js");
const { ValidationError } = await import("../domain/errors.js");
const { assertBlockers, checkCardBlockedBy, setCardBlockedBy } =
  await import("./card-blocked-by.js");

await store.load();

let boardCount = 0;
async function newBoard(): Promise<BoardKey> {
  const key = parseBoardKey(`TC${"ABCDEFGHIJ"[boardCount++]}`) as BoardKey;
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: [],
  });
  return key;
}

function ticket(board: BoardKey): Promise<Card> {
  return store.createLocalCard(board, "ticket", "");
}

function refusal(code: string) {
  return (err: unknown) =>
    err instanceof ValidationError && err.message === code;
}

after(() => {
  env.cleanup();
});

void test("setCardBlockedBy stores unique ids and returns the card", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const b = await ticket(board);
  const c = await ticket(board);

  const result = await setCardBlockedBy(c, [a.id, b.id, a.id]);

  assert.equal(result.id, c.id);
  assert.deepEqual(result.blockedBy, [a.id, b.id]);
  assert.deepEqual(store.getCard(c.id)?.blockedBy, [a.id, b.id]);
});

void test("a cycle throws blocked-by-cycle and stores nothing", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const b = await ticket(board);
  await setCardBlockedBy(b, [a.id]);

  await assert.rejects(
    setCardBlockedBy(a, [b.id]),
    refusal("blocked-by-cycle"),
  );

  assert.equal(store.getCard(a.id)?.blockedBy, undefined);
  assert.deepEqual(store.getCard(b.id)?.blockedBy, [a.id]);
});

void test("checkCardBlockedBy refuses a cycle and writes nothing", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const b = await ticket(board);
  await setCardBlockedBy(b, [a.id]);

  assert.throws(
    () => checkCardBlockedBy(a, [b.id]),
    refusal("blocked-by-cycle"),
  );
  assert.deepEqual(checkCardBlockedBy(a, []), []);
  assert.equal(store.getCard(a.id)?.blockedBy, undefined);
});

void test("assertBlockers refuses a card on another board", async () => {
  const board = await newBoard();
  const other = await newBoard();
  const foreign = await ticket(other);

  assert.throws(
    () => assertBlockers(board, [foreign.id]),
    refusal("invalid-blocker"),
  );
});
