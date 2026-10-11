import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  Board,
  BoardKey,
  OrchestratorConversation,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { setHooksRuntime, setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { orchestratorTools } =
  await import("../services/orchestration/orchestrator-session.js");
const express = (await import("express")).default;
const { orchestratorsRouter } = await import("./orchestrators.route.js");
const { refuseOrchestratorTokenOnUserRoute } =
  await import("./orchestrator.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const CVR = parseBoardKey("CVR") as BoardKey;
setOrchestrationConfig({ linearApiKey: "" });
setHooksRuntime({ capable: true, port: 4711, statusChannel: "hooks" });
await store.load();
await store.createBoard({
  key: CVR,
  name: "CVR",
  workspaceRoot: "/cvr/sessions",
  repositories: [],
  linearTeamKeys: [],
});
const board = () => store.getBoard(CVR) as Board;
await store.setBoardPolicy(CVR, { ...board().policy, supervisor: "on" });

orchestratorTools.mcpCommand = () => ({ command: "/node", args: ["mcp"] });
orchestratorTools.start = async (cardId) => {
  await store.completeStart(cardId, undefined, {
    workspacePath: `/cvr/sessions/${cardId}`,
    branch: cardId,
    tmuxSession: `dsp-${cardId}`,
  });
};

const app = express();
app.use("/api", refuseOrchestratorTokenOnUserRoute, httpErrorHandler);
app.use("/api", express.json(), orchestratorsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

async function get(
  route: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${route}`, { headers });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

const R = "/boards/CVR/orchestrators";
const line = (entry: unknown) => JSON.stringify(entry) + "\n";

void test("an orchestrator with no session answers no-session and an empty list", async () => {
  const added = await fetch(`${base}${R}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "main", name: "Main", role: "main" }),
  });
  assert.equal(added.status, 201);
  const reply = await get(`${R}/main/conversation`);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, {
    status: "no-session",
    messages: [],
    truncated: false,
  });
});

void test("a started orchestrator answers its transcript in order with system lines marked", async () => {
  const started = await fetch(`${base}${R}/main/start`, { method: "POST" });
  assert.equal(started.status, 202);
  await waitFor(
    () => Promise.resolve(board().orchestrators[0]?.state === "running"),
    2000,
    "running",
  );
  const record = board().orchestrators[0];
  const card = store.getCard(record?.cardId ?? "");
  const sessionId = card?.activeSessionId ?? "";
  const file = path.join(env.root, "projects", "cvr", "orchestrator.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    line({
      type: "user",
      uuid: "k",
      timestamp: "t1",
      message: {
        content: 'You are the orchestrator "Main" (id main) of board CVR.',
      },
    }) +
      line({
        type: "assistant",
        uuid: "a",
        timestamp: "t2",
        message: { content: [{ type: "text", text: "Plan ready." }] },
      }) +
      line({
        type: "user",
        uuid: "c",
        timestamp: "t3",
        message: { content: "Start the calendar group first." },
      }) +
      line({
        type: "user",
        uuid: "w",
        timestamp: "t4",
        message: { content: "Dispatch wake: CVR-1 needs input." },
      }),
  );
  await store.setTranscriptPath(card?.id ?? "", sessionId, file);
  const reply = await get(`${R}/main/conversation`);
  assert.equal(reply.status, 200);
  const body = reply.body as unknown as OrchestratorConversation;
  assert.equal(body.status, "ok");
  assert.deepEqual(
    body.messages.map((m) => [m.id, m.role]),
    [
      ["k", "system"],
      ["a", "orchestrator"],
      ["c", "user"],
      ["w", "system"],
    ],
  );
  const limited = await get(`${R}/main/conversation?limit=2`);
  const tail = limited.body as unknown as OrchestratorConversation;
  assert.deepEqual(
    tail.messages.map((m) => [m.id, m.role]),
    [
      ["c", "user"],
      ["w", "system"],
    ],
  );
  assert.equal(tail.truncated, true);
});

void test("an unknown board or orchestrator answers 404 and a bad limit answers 400", async () => {
  assert.equal(
    (await get("/boards/NOPE/orchestrators/main/conversation")).status,
    404,
  );
  const ghost = await get(`${R}/ghost/conversation`);
  assert.equal(ghost.status, 404);
  assert.equal(ghost.body.error, "unknown-orchestrator");
  for (const limit of ["0", "201", "x", "1.5"]) {
    const reply = await get(`${R}/main/conversation?limit=${limit}`);
    assert.equal(reply.status, 400, limit);
    assert.equal(reply.body.error, "invalid-limit");
  }
});

void test("a call with an orchestrator token is refused", async () => {
  const reply = await get(`${R}/main/conversation`, {
    "x-orchestrator-token": "any",
  });
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "orchestrator-token-on-user-route");
});
