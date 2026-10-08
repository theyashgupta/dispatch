import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { ConflictError, ValidationError } from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { actionableCard, groupedMemberError, moveCard } =
  await import("./card-move.js");

await store.load();
after(() => env.cleanup());

const ticket = (title: string) =>
  store.createLocalCard(DEFAULT_BOARD_KEY, title, "");

void test("groupedMemberError names the group of a member and is null for any other card", async () => {
  const a = await ticket("member a");
  const b = await ticket("member b");
  const made = await store.createGroupCard(DEFAULT_BOARD_KEY, "g", [
    a.id,
    b.id,
  ]);
  assert.ok(made.ok);
  const member = store.getCard(a.id)!;
  assert.equal(
    groupedMemberError(member),
    `card is grouped under ${made.card.id}, act on the group card`,
  );
  assert.equal(groupedMemberError(made.card), null);
  assert.equal(groupedMemberError(await ticket("plain")), null);
});

void test("actionableCard refuses an unknown id with 400 and a grouped member with 409", async () => {
  const a = await ticket("grouped a");
  const b = await ticket("grouped b");
  await store.createGroupCard(DEFAULT_BOARD_KEY, "g2", [a.id, b.id]);
  assert.throws(
    () => actionableCard("NOPE-1"),
    (err) =>
      err instanceof ValidationError && err.code === "unknown card id: NOPE-1",
  );
  assert.throws(() => actionableCard(a.id), ConflictError);
  const plain = await ticket("plain");
  assert.equal(actionableCard(plain.id).id, plain.id);
});

void test("moveCard moves a To Do card to Parked and back", async () => {
  const card = await ticket("movable");
  await moveCard(card.id, "parked");
  assert.equal(store.getCard(card.id)?.column, "parked");
  await moveCard(card.id, "todo");
  assert.equal(store.getCard(card.id)?.column, "todo");
});

void test("moveCard refuses Agent Done and a bare start with 409 and leaves the column", async () => {
  const card = await ticket("blocked");
  for (const column of ["agent_done", "in_progress"] as const) {
    await assert.rejects(moveCard(card.id, column), ConflictError, column);
    assert.equal(store.getCard(card.id)?.column, "todo", column);
  }
});

void test("moveCard promotes an Inbox card only to To Do", async () => {
  const card = await ticket("inbox card");
  await moveCard(card.id, "inbox");
  assert.equal(store.getCard(card.id)?.column, "inbox");
  await assert.rejects(
    moveCard(card.id, "parked"),
    (err) =>
      err instanceof ConflictError &&
      err.code === "inbox cards can only be promoted to To Do",
  );
  await moveCard(card.id, "todo");
  assert.equal(store.getCard(card.id)?.column, "todo");
});
