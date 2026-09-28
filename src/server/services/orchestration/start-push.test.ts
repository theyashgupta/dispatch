import assert from "node:assert/strict";
import { after, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";
import { issue } from "../../test-support/fake-source.js";
import {
  linearFixture,
  restoreFetch,
} from "../../test-support/linear-fetch.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { rebuildSources } = await import("../../adapters/source-gateway.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const { completeStartAndPush } = await import("./start-session.js");
await store.load();

after(restoreFetch);

const sent: { id: string; stateId: string }[] = [];
const sentCount = () => sent.length;

test("finishing a start on a To Do card pushes the default started state", async () => {
  globalThis.fetch = (_input, init) => {
    const body = JSON.parse(init?.body as string) as {
      query: string;
      variables: { id: string; input: { stateId: string } };
    };
    let data: unknown = { data: {} };
    if (body.query.includes("query Workflow")) {
      data = linearFixture("workflow.json");
    } else if (body.query.includes("mutation SetState")) {
      sent.push({
        id: body.variables.id,
        stateId: body.variables.input.stateId,
      });
      data = { data: { issueUpdate: { success: true } } };
    }
    return Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  const config = { linearApiKey: "k", sources: { linear: { apiKey: "k" } } };
  setOrchestrationConfig(config);
  rebuildSources(config);
  await store.applyIssues(
    [
      issue("s1", {
        team: { id: "team-eng", key: "ENG", name: "Engineering" },
        state: { id: "st-todo", name: "Todo", type: "unstarted" },
      }),
    ],
    new Date().toISOString(),
  );
  await store.moveCardManual("s1", "todo");

  await completeStartAndPush("s1", undefined, {
    workspacePath: "/tmp/ws/S1-1",
    branch: "S1-1",
    tmuxSession: "dsp-S1-1",
  });
  for (let i = 0; i < 50 && sent.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(store.getCard("s1")?.column, "in_progress");
  assert.deepEqual(sent, [{ id: "s1", stateId: "st-progress" }]);
});

test("finishing a start from In Review pushes nothing", async () => {
  const before = sentCount();
  await store.applyIssues(
    [
      issue("s2", {
        team: { id: "team-eng", key: "ENG", name: "Engineering" },
        state: { id: "st-todo", name: "Todo", type: "unstarted" },
      }),
    ],
    new Date().toISOString(),
  );
  await store.moveCardManual("s2", "todo");
  await store.moveCardManual("s2", "in_review");
  await completeStartAndPush("s2", undefined, {
    workspacePath: "/tmp/ws/S2-1",
    branch: "S2-1",
    tmuxSession: "dsp-S2-1",
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(store.getCard("s2")?.column, "in_progress");
  assert.equal(sentCount(), before);
});
