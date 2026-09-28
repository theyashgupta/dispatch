import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  linearFixture,
  queueLinearFetch,
  restoreFetch,
  testLinearSource,
} from "../../test-support/linear-fetch.js";
import { buildCreateInput } from "./create-input.js";

afterEach(restoreFetch);

const INPUT = {
  teamId: "team-eng",
  title: "Local sync card",
  description: "Body line",
  token: "dispatch-sync:LOCAL-1",
};

test("a token hit returns the existing issue and sends no Create", async () => {
  const sent = queueLinearFetch([[200, linearFixture("find-sync-hit.json")]]);
  const out = await testLinearSource().createIssue(INPUT);
  assert.equal(out.created, false);
  assert.equal(out.issue.identifier, "ENG-9");
  assert.deepEqual(
    sent.map((s) => /^\s*\w+\s+(\w+)/.exec(s.query)?.[1]),
    ["FindSync"],
  );
});

test("a miss sends Create after FindSync with the token as a variable", async () => {
  const sent = queueLinearFetch([
    [200, linearFixture("find-sync-miss.json")],
    [200, linearFixture("issue-create.json")],
  ]);
  const out = await testLinearSource().createIssue(INPUT);
  assert.equal(out.created, true);
  assert.equal(out.issue.id, "issue-10");
  assert.deepEqual(
    sent.map((s) => /^\s*\w+\s+(\w+)/.exec(s.query)?.[1]),
    ["FindSync", "Create"],
  );
  assert.deepEqual(sent[0]?.variables, {
    filter: {
      description: { contains: "dispatch-sync:LOCAL-1" },
      creator: { isMe: { eq: true } },
    },
  });
  assert.ok(!sent[0]?.query.includes("dispatch-sync"));
  assert.deepEqual(sent[1]?.variables, {
    input: {
      teamId: "team-eng",
      title: "Local sync card",
      description: "Body line\n\ndispatch-sync:LOCAL-1",
    },
  });
});

test("Create with success false throws", async () => {
  queueLinearFetch([
    [200, linearFixture("find-sync-miss.json")],
    [200, { data: { issueCreate: { success: false, issue: null } } }],
  ]);
  await assert.rejects(testLinearSource().createIssue(INPUT));
});

test("Create with success true but no issue throws", async () => {
  queueLinearFetch([
    [200, linearFixture("find-sync-miss.json")],
    [200, { data: { issueCreate: { success: true, issue: null } } }],
  ]);
  await assert.rejects(
    testLinearSource().createIssue(INPUT),
    /did not create the issue/,
  );
});

test("buildCreateInput ends the description with the token", () => {
  assert.equal(
    buildCreateInput({ ...INPUT, description: "Body" }).description,
    "Body\n\ndispatch-sync:LOCAL-1",
  );
  assert.equal(
    buildCreateInput({ ...INPUT, description: null }).description,
    "dispatch-sync:LOCAL-1",
  );
  assert.equal(
    buildCreateInput({ ...INPUT, description: "" }).description,
    "dispatch-sync:LOCAL-1",
  );
});

test("buildCreateInput keeps stateId only when given and priority only from 1 to 4", () => {
  assert.equal("stateId" in buildCreateInput(INPUT), false);
  assert.equal(
    buildCreateInput({ ...INPUT, stateId: "st-progress" }).stateId,
    "st-progress",
  );
  for (const priority of [0, 5]) {
    assert.equal("priority" in buildCreateInput({ ...INPUT, priority }), false);
  }
  for (const priority of [1, 4]) {
    assert.equal(buildCreateInput({ ...INPUT, priority }).priority, priority);
  }
});

test("buildCreateInput flattens title newlines to spaces", () => {
  assert.equal(
    buildCreateInput({ ...INPUT, title: "Line one\nLine two\r\nthree" }).title,
    "Line one Line two three",
  );
});

test("a hit whose token only shares a prefix is not adopted, and Create runs", async () => {
  const prefixHit = {
    data: {
      issues: {
        nodes: [
          {
            id: "issue-12",
            identifier: "ENG-12",
            url: "u",
            title: "Other card",
            description: "Body\n\ndispatch-sync:LOCAL-12",
          },
        ],
      },
    },
  };
  const sent = queueLinearFetch([
    [200, prefixHit],
    [200, linearFixture("issue-create.json")],
  ]);
  const out = await testLinearSource().createIssue(INPUT);
  assert.equal(out.created, true);
  assert.equal(out.issue.id, "issue-10");
  assert.equal(sent.length, 2);
});

test("a FindSync answer without an issues list throws instead of creating", async () => {
  const sent = queueLinearFetch([[200, { data: { issues: null } }]]);
  await assert.rejects(testLinearSource().createIssue(INPUT));
  assert.equal(sent.length, 1);
});
