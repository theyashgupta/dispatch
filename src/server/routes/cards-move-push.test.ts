import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import { linearFixture, restoreFetch } from "../test-support/linear-fetch.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { cardsRouter } = await import("./cards.route.js");

const TEAM = { id: "team-eng", key: "ENG", name: "Engineering" };
const TODO = { id: "st-todo", name: "Todo", type: "unstarted" };
const setStates: { id: string; stateId: string }[] = [];
let server: Server;
let base: string;

/** Answer Linear by operation, holding SetState for 1500 ms; loopback calls reach the real fetch. */
function stubSlowLinear(): void {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.startsWith("http://127.0.0.1")) return real(input, init);
    const body = JSON.parse(init?.body as string) as {
      query: string;
      variables: { id: string; input: { stateId: string } };
    };
    let data: unknown = { data: {} };
    if (body.query.includes("query Workflow")) {
      data = linearFixture("workflow.json");
    } else if (body.query.includes("mutation SetState")) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setStates.push({
        id: body.variables.id,
        stateId: body.variables.input.stateId,
      });
      data = { data: { issueUpdate: { success: true } } };
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

before(async () => {
  await store.load();
  const config = {
    linearApiKey: "k",
    sources: {
      linear: {
        apiKey: "k",
        stateMap: { "team-eng": { in_review: "st-progress" } },
      },
    },
  };
  setOrchestrationConfig(config);
  rebuildSources(config);
  stubSlowLinear();
  const app = express();
  app.use("/api", express.json(), cardsRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}/api`;
});

after(() => {
  restoreFetch();
  server.close();
});

const moveTo = (id: string, column: string) =>
  fetch(`${base}/cards/${id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column }),
  });

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("the move route answers before Linear does and pushes only the changed Linear cards, mirrored members included", async () => {
  await store.applyIssues(
    ["m1", "m2", "m3", "still"].map((id) =>
      issue(id, { team: TEAM, state: TODO }),
    ),
    new Date().toISOString(),
  );
  for (const id of ["m1", "m2", "m3", "still"]) {
    await store.moveCardManual(id, "todo");
  }
  const group = await store.createGroupCard(DEFAULT_BOARD_KEY, "Group", [
    "m1",
    "m2",
  ]);
  assert.ok(group.ok);

  assert.equal((await moveTo("m3", "in_review")).status, 204);
  assert.equal((await moveTo(group.card.id, "in_review")).status, 204);
  assert.equal(setStates.length, 0, "the route waited for Linear");

  await waitFor(() => setStates.length >= 3);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(setStates.map((s) => `${s.id}:${s.stateId}`).sort(), [
    "m1:st-progress",
    "m2:st-progress",
    "m3:st-progress",
  ]);
});
