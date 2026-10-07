import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { isolateEnv } from "../../test-support/fixtures.js";
import { materializeLoopFixture } from "../../test-support/loop-fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { readLoopProgress } = await import("./loop-progress-reader.js");

const root = materializeLoopFixture("g14-partial");

after(() => {
  rmSync(root, { recursive: true, force: true });
  env.cleanup();
});

await store.load();
const members = [
  await store.createLocalCard(DEFAULT_BOARD_KEY, "loop-store-a", ""),
  await store.createLocalCard(DEFAULT_BOARD_KEY, "loop-store-b", ""),
];
const grouped = await store.createGroupCard(
  DEFAULT_BOARD_KEY,
  "loop-store-group",
  members.map((m) => m.id),
);
assert.ok(grouped.ok);
const cardId = grouped.card.id;

void test("two real reads of an unchanged loop fire exactly one store change", async () => {
  const first = await readLoopProgress(root);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await readLoopProgress(root);
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.readAt, second.readAt);

  let changes = 0;
  const onChange = () => changes++;
  store.on("change", onChange);
  try {
    await store.setLoopProgress(cardId, first);
    await store.setLoopProgress(cardId, second);
  } finally {
    store.off("change", onChange);
  }

  assert.equal(changes, 1);
  assert.equal(store.getCard(cardId)?.loopProgress?.readAt, first.readAt);
});
