import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  queueLinearFetch,
  restoreFetch,
} from "../../test-support/linear-fetch.js";
import { setOrchestrationConfig } from "../infra/config-holder.js";
import { resolveIssueId } from "./linear-sync.js";

setOrchestrationConfig({ linearApiKey: "fake-key" });
afterEach(restoreFetch);

function issue(description: string, isMe: boolean) {
  return {
    data: { issue: { id: "issue-9", description, creator: { isMe } } },
  };
}

test("an issue the viewer created with the token as a whole line is adopted", async () => {
  const sent = queueLinearFetch([
    [200, issue("Body\ndispatch-sync:LOCAL-1", true)],
  ]);
  assert.equal(
    await resolveIssueId("ENG-9", "dispatch-sync:LOCAL-1"),
    "issue-9",
  );
  assert.match(sent[0].query, /creator \{ isMe \}/);
});

test("an issue another Linear user created is refused even with the token line", async () => {
  queueLinearFetch([[200, issue("Body\ndispatch-sync:LOCAL-1", false)]]);
  await assert.rejects(
    resolveIssueId("ENG-9", "dispatch-sync:LOCAL-1"),
    /not created by this Linear user/,
  );
});

test("a token inside a line or on a longer id is refused", async () => {
  queueLinearFetch([
    [200, issue("see dispatch-sync:LOCAL-1 here", true)],
    [200, issue("dispatch-sync:LOCAL-12", true)],
  ]);
  await assert.rejects(
    resolveIssueId("ENG-9", "dispatch-sync:LOCAL-1"),
    /does not carry the sync idempotency token/,
  );
  await assert.rejects(
    resolveIssueId("ENG-9", "dispatch-sync:LOCAL-1"),
    /does not carry the sync idempotency token/,
  );
});
