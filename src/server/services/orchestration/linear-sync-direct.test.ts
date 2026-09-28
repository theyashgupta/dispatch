import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFakeSource } from "../../test-support/fake-source.js";
import { syncCard, syncCardDirect } from "./linear-sync.js";

const CARD = {
  id: "LOCAL-1",
  title: "Local sync card",
  description: "Body line",
  priority: 2,
};
const SYNCED = {
  identifier: "ENG-10",
  url: "u",
  issueId: "issue-10",
  title: "t",
  description: "d",
};

function paths(viaClaude: boolean) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      viaClaude: () => viaClaude,
      direct: () => {
        calls.push("direct");
        return Promise.resolve(SYNCED);
      },
      claude: () => {
        calls.push("claude");
        return Promise.resolve(SYNCED);
      },
    },
  };
}

test("syncCard takes the direct path when the flag is off", async () => {
  const p = paths(false);
  await syncCard(CARD, { teamId: "team-eng" }, p.deps);
  assert.deepEqual(p.calls, ["direct"]);
});

test("syncCard takes the Claude path when the flag is on, even without a team", async () => {
  const p = paths(true);
  await syncCard(CARD, undefined, p.deps);
  assert.deepEqual(p.calls, ["claude"]);
});

test("syncCard refuses the direct path without a team", async () => {
  const p = paths(false);
  await assert.rejects(syncCard(CARD, undefined, p.deps), /teamId is required/);
  assert.deepEqual(p.calls, []);
});

test("syncCardDirect passes the token, team, state and priority and maps the issue", async () => {
  let seen: unknown;
  const source = {
    ...makeFakeSource({ id: "linear" }),
    createIssue: (input: unknown) => {
      seen = input;
      return Promise.resolve({
        created: true,
        issue: {
          id: "issue-10",
          identifier: "ENG-10",
          url: "u",
          title: "Local sync card",
          description: "Body line\n\ndispatch-sync:LOCAL-1",
        },
      });
    },
  };
  const out = await syncCardDirect(
    CARD,
    { teamId: "team-eng", stateId: "st-progress" },
    source,
  );
  assert.deepEqual(seen, {
    teamId: "team-eng",
    stateId: "st-progress",
    title: "Local sync card",
    description: "Body line",
    token: "dispatch-sync:LOCAL-1",
    priority: 2,
  });
  assert.equal(out.issueId, "issue-10");
  assert.equal(out.identifier, "ENG-10");
});

test("syncCardDirect refuses when Linear is not connected", async () => {
  await assert.rejects(
    syncCardDirect(CARD, { teamId: "team-eng" }, undefined),
    /not connected/,
  );
});
