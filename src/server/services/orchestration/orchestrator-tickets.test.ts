import test, { after } from "node:test";
import assert from "node:assert/strict";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import { issue } from "../../test-support/fake-source.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import {
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
} from "../domain/errors.js";
import type { OutboundDeps } from "./linear-outbound.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const {
  commentOnTicket,
  commentOutbound,
  createOrchestratorTicket,
  moveTicket,
  updateTicket,
} = await import("./orchestrator-tickets.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const CALLER = { boardKey: SBX, orchestratorId: "orc-sbx" };
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: ["LIN"],
});
await store.applyIssues(
  [issue("lin-1", { identifier: "LIN-1" })],
  new Date().toISOString(),
  { source: "linear" },
);
const linear = store.getCard("lin-1")!;
assert.equal(linear.boardKey, SBX);
after(() => env.cleanup());

const own = () =>
  createOrchestratorTicket(CALLER, { title: "own", fullDescription: "d" });

void test("createOrchestratorTicket stores a local ticket marked with the orchestrator", async () => {
  const card = await createOrchestratorTicket(CALLER, {
    title: "new",
    fullDescription: "what to do",
  });
  const stored = store.getCard(card.id)!;
  assert.equal(stored.boardKey, SBX);
  assert.equal(stored.source, "local");
  assert.equal(stored.description, "what to do");
  assert.equal(stored.createdByOrchestrator, "orc-sbx");
  assert.equal(card.createdByOrchestrator, "orc-sbx");
});

void test("updateTicket changes a local card and refuses a group card and a Linear card", async () => {
  const card = await own();
  const updated = await updateTicket(card, { title: "renamed" });
  assert.equal(updated.title, "renamed");
  assert.equal(store.getCard(card.id)?.description, "d");
  const a = await store.createLocalCard(SBX, "ga", "");
  const b = await store.createLocalCard(SBX, "gb", "");
  const group = await store.createGroupCard(SBX, "grp", [a.id, b.id]);
  assert.ok(group.ok);
  await assert.rejects(
    updateTicket(group.card, { title: "x" }),
    (err) => err instanceof ConflictError && err.code === "not-a-ticket",
  );
  await assert.rejects(
    updateTicket(linear, { title: "x" }),
    (err) =>
      err instanceof ConflictError &&
      err.code === "linear-card" &&
      err.details?.reason === "linear card: edit in Linear",
  );
  assert.equal(store.getCard(linear.id)?.title, linear.title);
});

void test("moveTicket moves a card by the manual rules and allows Done only for an own card", async () => {
  const card = await own();
  const parked = await moveTicket(CALLER, card, "parked");
  assert.equal(parked.column, "parked");
  const done = await moveTicket(CALLER, store.getCard(card.id)!, "done");
  assert.equal(done.column, "done");
});

void test("moveTicket refuses Done for a card of a person and for a group, and leaves the column", async () => {
  const person = await store.createLocalCard(SBX, "person", "");
  await assert.rejects(
    moveTicket(CALLER, person, "done"),
    (err) => err instanceof ForbiddenError && err.code === "done-not-own-card",
  );
  assert.equal(store.getCard(person.id)?.column, "todo");
  const a = await store.createLocalCard(SBX, "da", "");
  const b = await store.createLocalCard(SBX, "db", "");
  const group = await store.createGroupCard(SBX, "own group", [a.id, b.id]);
  assert.ok(group.ok);
  await store.setOrchestratorFields(group.card.id, {
    createdByOrchestrator: "orc-sbx",
  });
  await assert.rejects(
    moveTicket(CALLER, store.getCard(group.card.id)!, "done"),
    (err) => err instanceof ConflictError && err.code === "group-done-by-ship",
  );
  assert.equal(store.getCard(group.card.id)?.column, "todo");
});

void test("commentOnTicket appends a local entry on a local card and returns it", async () => {
  const card = await own();
  const comment = await commentOnTicket(CALLER, card, "progress note");
  assert.ok(comment);
  assert.match(comment.id, /^local-[0-9a-f-]{36}$/);
  assert.equal(comment.author, "orchestrator:orc-sbx");
  assert.deepEqual(store.getCard(card.id)?.comments, [comment]);
});

void test("commentOnTicket posts a Linear card comment through the source and maps a failure to 502", async () => {
  const sent: [string, string][] = [];
  let fail = false;
  const source = {
    addComment: (issueId: string, body: string) => {
      if (fail) return Promise.reject(new Error("boom"));
      sent.push([issueId, body]);
      return Promise.resolve();
    },
  } as unknown as ReturnType<OutboundDeps["source"]>;
  commentOutbound.deps = {
    source: () => source,
    poll: () => true,
    now: () => Date.now(),
  };
  try {
    assert.equal(await commentOnTicket(CALLER, linear, "hello"), null);
    assert.deepEqual(sent, [[linear.issueId, "hello"]]);
    fail = true;
    await assert.rejects(
      commentOnTicket(CALLER, linear, "again"),
      (err) => err instanceof HttpError && err.status === 502,
    );
    assert.equal(sent.length, 1);
  } finally {
    commentOutbound.deps = undefined;
  }
});

void test("commentOnTicket maps an unknown local card to 404 and leaves no comment", async () => {
  const card = await own();
  const gone = { ...card, id: "LOCAL-9999" };
  await assert.rejects(commentOnTicket(CALLER, gone, "x"), NotFoundError);
  assert.equal(store.getCard(card.id)?.comments, undefined);
});
