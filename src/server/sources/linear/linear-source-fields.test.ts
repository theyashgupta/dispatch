import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  linearFixture,
  restoreFetch,
  stubLinearFetch,
  testLinearSource,
} from "../../test-support/linear-fetch.js";

const boardPage = linearFixture("board-page.json");

afterEach(restoreFetch);

test("the board query selects state color, team, cycle and assignee", async () => {
  const sent = stubLinearFetch(200, boardPage);
  await testLinearSource().fetch();
  const query = sent[0]?.query ?? "";
  for (const field of [
    "state { id name type color }",
    "team { id key name }",
    "cycle { number }",
    "assignee { id displayName }",
    "comments(last: 5) { nodes { id body createdAt user { displayName } } }",
  ]) {
    assert.ok(query.includes(field), `query selects ${field}`);
  }
});

test("the mapping copies state id and color, team, cycle and assignee", async () => {
  stubLinearFetch(200, boardPage);
  const { issues } = await testLinearSource().fetch();
  const full = issues.find((i) => i.id === "issue-1");
  assert.deepEqual(full?.state, {
    id: "state-started",
    name: "In Progress",
    type: "started",
    color: "#f2c94c",
  });
  assert.deepEqual(full?.team, {
    id: "team-eng",
    key: "ENG",
    name: "Engineering",
  });
  assert.equal(full?.cycle, 14);
  assert.deepEqual(full?.assignee, { id: "user-me", name: "Me" });
});

test("absent team, cycle, assignee and color stay undefined", async () => {
  stubLinearFetch(200, boardPage);
  const { issues } = await testLinearSource().fetch();
  const bare = issues.find((i) => i.id === "issue-2");
  assert.equal(bare?.team, undefined);
  assert.equal(bare?.cycle, undefined);
  assert.equal(bare?.assignee, undefined);
  const noColor = issues.find((i) => i.id === "issue-3");
  assert.equal(noColor?.state?.color, undefined);
  assert.equal(noColor?.state?.id, "state-review");
});

test("the mapping sorts comments oldest first, caps a long body and names a null user Linear", async () => {
  stubLinearFetch(200, boardPage);
  const { issues } = await testLinearSource().fetch();
  const comments = issues.find((i) => i.id === "issue-1")?.comments ?? [];
  assert.deepEqual(
    comments.map((c) => c.id),
    ["c-1", "c-2", "c-3"],
  );
  assert.deepEqual(comments[0], {
    id: "c-1",
    body: "First **comment**",
    createdAt: "2026-09-22T12:00:00.000Z",
    author: "Grace",
  });
  assert.equal(comments[1]?.author, "Linear");
  assert.equal(comments[2]?.body.length, 600);
  assert.equal(comments[2]?.body, `${"x".repeat(599)}…`);
});

test("an issue with no comments maps to an empty list", async () => {
  stubLinearFetch(200, boardPage);
  const { issues } = await testLinearSource().fetch();
  assert.deepEqual(issues.find((i) => i.id === "issue-2")?.comments, []);
  assert.deepEqual(issues.find((i) => i.id === "issue-3")?.comments, []);
});

test("the cap never splits an emoji at the cut", async () => {
  const page = structuredClone(boardPage) as {
    data: { viewer: { assignedIssues: { nodes: Record<string, unknown>[] } } };
  };
  const body = `${"a".repeat(598)}\u{1F600}${"b".repeat(50)}`;
  page.data.viewer.assignedIssues.nodes[0].comments = {
    nodes: [
      { id: "e", body, createdAt: "2026-09-25T00:00:00.000Z", user: null },
    ],
  };
  stubLinearFetch(200, page);
  const { issues } = await testLinearSource().fetch();
  const capped = issues[0]?.comments?.[0]?.body ?? "";
  assert.equal(capped, `${"a".repeat(598)}\u2026`);
  assert.ok(!/[\uD800-\uDBFF]/.test(capped));
});

test("a body of exactly 600 characters is kept whole", async () => {
  const page = structuredClone(boardPage) as {
    data: { viewer: { assignedIssues: { nodes: Record<string, unknown>[] } } };
  };
  page.data.viewer.assignedIssues.nodes[0].comments = {
    nodes: [
      {
        id: "x",
        body: "y".repeat(600),
        createdAt: "2026-09-25T00:00:00.000Z",
        user: null,
      },
    ],
  };
  stubLinearFetch(200, page);
  const { issues } = await testLinearSource().fetch();
  assert.equal(issues[0]?.comments?.[0]?.body, "y".repeat(600));
});
