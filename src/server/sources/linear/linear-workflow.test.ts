import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  linearFixture,
  restoreFetch,
  stubLinearFetch,
  testLinearSource,
} from "../../test-support/linear-fetch.js";

afterEach(restoreFetch);

test("the workflow is one request with teams by name and states by position", async () => {
  const sent = stubLinearFetch(200, linearFixture("workflow.json"));
  const workflow = await testLinearSource().workflow();
  assert.equal(sent.length, 1);
  assert.ok(sent[0]?.query.includes("viewer { id }"));
  assert.equal(workflow.viewerId, "user-me");
  assert.deepEqual(
    workflow.teams.map((t) => t.key),
    ["ENG", "X"],
  );
  assert.deepEqual(
    workflow.teams[0]?.states.map((s) => s.id),
    ["st-backlog", "st-todo", "st-progress"],
  );
  assert.equal(workflow.teams[1]?.states[0]?.color, undefined);
});

test("a workflow answer without a viewer throws", async () => {
  const body = linearFixture("workflow.json") as { data: { viewer?: unknown } };
  delete body.data.viewer;
  stubLinearFetch(200, body);
  await assert.rejects(testLinearSource().workflow(), /missing viewer/);
});

test("the viewer id is cached after a successful workflow read", async () => {
  const source = testLinearSource();
  stubLinearFetch(200, linearFixture("workflow.json"));
  await source.workflow();
  const sent = stubLinearFetch(500, {});
  assert.equal(await source.viewerId(), "user-me");
  assert.equal(sent.length, 0);
});

test("a failed viewer read is not cached and the next read asks again", async () => {
  const source = testLinearSource();
  stubLinearFetch(401, {
    errors: [{ extensions: { code: "AUTHENTICATION_ERROR" } }],
  });
  await assert.rejects(source.viewerId());
  const sent = stubLinearFetch(200, { data: { viewer: { id: "user-me" } } });
  assert.equal(await source.viewerId(), "user-me");
  assert.equal(sent.length, 1);
});

test("assignIssue sends the id and assignee as variables and throws on success false", async () => {
  const sent = stubLinearFetch(200, linearFixture("assign.json"));
  await testLinearSource().assignIssue("issue-1", "user-me");
  assert.deepEqual(sent[0]?.variables, {
    id: "issue-1",
    input: { assigneeId: "user-me" },
  });
  stubLinearFetch(200, { data: { issueUpdate: { success: false } } });
  await assert.rejects(testLinearSource().assignIssue("issue-1", "user-me"));
});

test("updateState sends the state as a variable and throws on success false", async () => {
  const sent = stubLinearFetch(200, {
    data: { issueUpdate: { success: false } },
  });
  await assert.rejects(
    testLinearSource().updateState("issue-1", "st-done"),
    /did not update the issue/,
  );
  assert.ok(sent[0]?.query.startsWith("mutation SetState"));
  assert.deepEqual(sent[0]?.variables, {
    id: "issue-1",
    input: { stateId: "st-done" },
  });
});
