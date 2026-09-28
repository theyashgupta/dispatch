import assert from "node:assert/strict";
import { test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";

isolateEnv();
const { store } = await import("./board.store.js");
await store.load();

const COMMENT = {
  id: "c1",
  body: "Secret-free but heavy body",
  createdAt: "2026-09-24T10:00:00.000Z",
  author: "Ada",
};

test("snapshot cards carry commentCount and never the comment bodies", async () => {
  await store.applyIssues(
    [
      issue("with", { comments: [COMMENT, { ...COMMENT, id: "c2" }] }),
      issue("none", { comments: [] }),
    ],
    new Date().toISOString(),
    { source: "linear" },
  );
  await store.moveCardManual("with", "todo");
  await store.moveCardManual("with", "in_review");
  const local = await store.createLocalCard("local", "");

  const cards = store.snapshot().cards;
  const byId = new Map(cards.map((c) => [c.id, c]));
  assert.equal(byId.get("with")?.commentCount, 2);
  assert.equal(byId.get("with")?.lastCommentId, "c2");
  assert.equal(byId.get("none")?.lastCommentId, undefined);
  assert.equal(byId.get("none")?.commentCount, 0);
  assert.equal(byId.get(local.id)?.commentCount, undefined);
  for (const c of cards) assert.equal("comments" in c, false);
  assert.ok(!JSON.stringify(store.snapshot()).includes(COMMENT.body));
  assert.equal(store.getCard("with")?.comments?.length, 2);
});
