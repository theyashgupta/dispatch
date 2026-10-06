import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardSnapshot } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeBoardRepository } from "../test-support/fake-board-repository.js";
import { ALL_BOARDS, DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

isolateEnv();
const { store } = await import("./board.store.js");
const { boardRepository, setBoardRepository } =
  await import("./board-repository.js");
await store.load();

test("the default target is the real store", async () => {
  const card = await store.createLocalCard(
    DEFAULT_BOARD_KEY,
    "default target",
    "",
  );
  assert.equal(boardRepository.getCard(card.id), store.getCard(card.id));
  assert.deepEqual(
    boardRepository.listCards(ALL_BOARDS),
    store.listCards(ALL_BOARDS),
  );
  assert.equal(
    boardRepository.getArchiveRetentionDays(),
    store.getArchiveRetentionDays(),
  );
});

test("after the setter swaps the target, a call reaches the fake", (t) => {
  t.after(() => setBoardRepository(store));
  const snapshot = { cards: [] } as unknown as BoardSnapshot;
  setBoardRepository(fakeBoardRepository({ snapshot: () => snapshot }));
  assert.equal(boardRepository.snapshot(DEFAULT_BOARD_KEY), snapshot);
  assert.throws(() => boardRepository.listCards(ALL_BOARDS), {
    message: "fakeBoardRepository: listCards is not faked",
  });
});

test("a method that uses private store state works through the forwarding constant", async (t) => {
  const seen: unknown[] = [];
  const listener = (): void => {
    seen.push("change");
  };
  t.after(() => store.off("change", listener));
  assert.equal(boardRepository.on("change", listener), store);
  const card = await boardRepository.createLocalCard(
    DEFAULT_BOARD_KEY,
    "through proxy",
    "",
  );
  assert.ok(seen.length > 0);
  assert.equal(store.getCard(card.id)?.title, "through proxy");
  await boardRepository.setStatusReason(card.id, "private queue");
  assert.equal(store.getCard(card.id)?.statusReason, "private queue");
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { listCards } = boardRepository;
  assert.deepEqual(listCards(ALL_BOARDS), store.listCards(ALL_BOARDS));
});
