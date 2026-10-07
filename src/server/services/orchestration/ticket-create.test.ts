import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { BoardConflictError, BoardNotFoundError } from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { createTicket } = await import("./ticket-create.js");

await store.load();

after(() => {
  env.cleanup();
});

void test("createTicket stores a local card with its title and description on the board", async () => {
  const card = await createTicket(DEFAULT_BOARD_KEY, {
    title: "a ticket",
    fullDescription: "details",
  });
  const stored = store.getCard(card.id);
  assert.equal(stored?.title, "a ticket");
  assert.equal(stored?.description, "details");
  assert.equal(stored?.source, "local");
  assert.equal(stored?.boardKey ?? DEFAULT_BOARD_KEY, DEFAULT_BOARD_KEY);
});

void test("createTicket maps an archived board to board-archived", async () => {
  const key = parseBoardKey("ARCH");
  assert.ok(key);
  const made = await store.createBoard({
    key,
    name: "Archived",
    workspaceRoot: env.root,
    repositories: [],
    linearTeamKeys: [],
  });
  assert.equal(made.ok, true);
  await store.setBoardArchived(key, true);
  await assert.rejects(
    createTicket(key, { title: "t", fullDescription: "" }),
    (err: unknown) =>
      err instanceof BoardConflictError &&
      err.details?.code === "board-archived",
  );
});

void test("createTicket maps an unknown board to unknown-board", async () => {
  const key = parseBoardKey("NOPE");
  assert.ok(key);
  await assert.rejects(
    createTicket(key, { title: "t", fullDescription: "" }),
    (err: unknown) =>
      err instanceof BoardNotFoundError &&
      err.details?.code === "unknown-board",
  );
});
