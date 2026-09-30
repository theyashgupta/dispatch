import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../shared/types.js";
import { fakeBoardRepository } from "./fake-board-repository.js";

test("an overridden member is used", () => {
  const card = { id: "c1" } as Card;
  const repo = fakeBoardRepository({
    getCard: (id) => (id === "c1" ? card : undefined),
  });
  assert.equal(repo.getCard("c1"), card);
  assert.equal(repo.getCard("nope"), undefined);
});

test("a member that is not faked throws with its name when called", () => {
  const repo = fakeBoardRepository({ getCard: () => undefined });
  assert.throws(() => repo.listCards(), {
    message: "fakeBoardRepository: listCards is not faked",
  });
  assert.throws(() => repo.setSyncing("c1", true), {
    message: "fakeBoardRepository: setSyncing is not faked",
  });
});

test("awaiting the fake resolves and a symbol key reads as undefined", async () => {
  const repo = fakeBoardRepository({});
  assert.equal(Reflect.get(repo, "then"), undefined);
  assert.equal(await Promise.resolve(repo), repo);
  assert.equal(Reflect.get(repo, Symbol.iterator), undefined);
});
