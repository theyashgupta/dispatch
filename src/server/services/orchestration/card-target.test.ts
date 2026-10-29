import test, { after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { ConflictError, ValidationError } from "../domain/errors.js";

const env = isolateEnv();
const { DISPATCH_DATA_DIR } = await import("../../store/data-dir.js");
assert.notEqual(
  path.resolve(DISPATCH_DATA_DIR),
  path.join(os.userInfo().homedir, ".dispatch"),
  "test bound to the live board.db",
);
const { store } = await import("../../store/board.store.js");
const { actionableCard, groupedMemberError } = await import("./card-target.js");

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
