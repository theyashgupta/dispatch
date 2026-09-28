import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  linearFixture,
  restoreFetch,
  stubLinearFetch,
  testLinearSource,
} from "../../test-support/linear-fetch.js";

const trackedPage = linearFixture("tracked-page.json");

afterEach(restoreFetch);

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `issue-${i}`);

test("tracked ids travel only as the $ids variable and map through the issue node", async () => {
  const sent = stubLinearFetch(200, trackedPage);
  const issues = await testLinearSource().fetchByIds(["issue-4"]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.variables.ids, ["issue-4"]);
  assert.ok(!sent[0]?.query.includes("issue-4"));
  assert.ok(sent[0]?.query.includes("id: { in: $ids }"));
  assert.deepEqual(issues[0]?.state, {
    id: "state-started",
    name: "In Progress",
    type: "started",
    color: "#f2c94c",
  });
  assert.equal(issues[0]?.cycle, 14);
});

test("600 ids go out as three requests of 250, 250 and 100", async () => {
  const sent = stubLinearFetch(200, { data: { issues: { nodes: [] } } });
  await testLinearSource().fetchByIds(ids(600));
  assert.deepEqual(
    sent.map((s) => (s.variables.ids as string[] | undefined)?.length),
    [250, 250, 100],
  );
});

test("more than 1000 ids throws before any request", async () => {
  const sent = stubLinearFetch(200, { data: { issues: { nodes: [] } } });
  await assert.rejects(testLinearSource().fetchByIds(ids(1001)), /1000 cap/);
  assert.equal(sent.length, 0);
});

test("a 401 raises the credential rejection", async () => {
  stubLinearFetch(401, {
    errors: [{ extensions: { code: "AUTHENTICATION_ERROR" } }],
  });
  await assert.rejects(testLinearSource().fetchByIds(["issue-4"]), {
    name: "LinearAuthError",
  });
});

test("exactly 1000 ids are accepted and go out as four requests", async () => {
  const sent = stubLinearFetch(200, { data: { issues: { nodes: [] } } });
  await testLinearSource().fetchByIds(ids(1000));
  assert.equal(sent.length, 4);
});

test("a response without an issues connection throws", async () => {
  stubLinearFetch(200, { data: {} });
  await assert.rejects(
    testLinearSource().fetchByIds(["issue-4"]),
    /missing issues connection/,
  );
});

test("an issue with no state maps to a null state", async () => {
  stubLinearFetch(200, {
    data: {
      issues: {
        nodes: [
          {
            id: "issue-9",
            identifier: "ENG-9",
            title: "No state",
            url: "https://linear.app/acme/issue/ENG-9",
            description: null,
            priority: 0,
            updatedAt: "2026-09-25T10:00:00.000Z",
            state: null,
            team: null,
            cycle: null,
            project: null,
            assignee: null,
          },
        ],
      },
    },
  });
  const [only] = await testLinearSource().fetchByIds(["issue-9"]);
  assert.equal(only?.state, null);
});
