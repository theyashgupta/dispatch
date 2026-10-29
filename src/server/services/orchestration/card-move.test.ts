import test, { after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import fs from "node:fs";
import { isolateEnv, waitFor } from "../../test-support/fixtures.js";
import { ConflictError } from "../domain/errors.js";

const env = isolateEnv();
const { DISPATCH_DATA_DIR } = await import("../../store/data-dir.js");
assert.notEqual(
  path.resolve(DISPATCH_DATA_DIR),
  path.join(os.userInfo().homedir, ".dispatch"),
  "test bound to the live board.db",
);
const { store } = await import("../../store/board.store.js");
const { tempRepoWithWorkspace } =
  await import("../../test-support/git-fixtures.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const { sessionStarter } = await import("./start-session.js");
const { moveCard } = await import("./card-move.js");

const fixture = await tempRepoWithWorkspace();
const starts: string[] = [];
sessionStarter.start = (id) => {
  starts.push(id);
  return Promise.resolve();
};
setOrchestrationConfig({ linearApiKey: "" });
await store.load();
after(() => {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  env.cleanup();
});

const ticket = (title: string) =>
  store.createLocalCard(DEFAULT_BOARD_KEY, title, "");

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

async function blockedTicket(...blockers: string[]) {
  const card = await ticket("blocked");
  await store.setCardWorkspace(card.id, {
    folder: fixture.root,
    repos: [{ path: fixture.repo, base: "main" }],
  });
  await store.setBlockedBy(card.id, blockers);
  return card;
}

void test("a move to Done starts the blocked To Do card that it unblocks", async () => {
  const blocker = await ticket("blocker");
  const card = await blockedTicket(blocker.id);
  await moveCard(blocker.id, "done");
  await waitFor(
    () => Promise.resolve(starts.includes(card.id)),
    2000,
    "blocked card start",
  );
  assert.equal(store.getCard(card.id)?.column, "todo");
});

void test("a move to another column starts nothing", async () => {
  const blocker = await ticket("blocker");
  const other = await ticket("other");
  const card = await blockedTicket(blocker.id);
  await store.moveCardManual(blocker.id, "done");
  await moveCard(other.id, "parked");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(starts.includes(card.id), false);
  await moveCard(other.id, "todo");
  await moveCard(other.id, "done");
  await waitFor(
    () => Promise.resolve(starts.includes(card.id)),
    2000,
    "blocked card start",
  );
});
