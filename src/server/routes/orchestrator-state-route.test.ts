import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, OrchestratorRecord } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { mintOrchestratorToken } =
  await import("../services/orchestration/orchestrator-tokens.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");

const SBX = parseBoardKey("SBX") as BoardKey;

await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});

function record(id: string, role: "main" | "extra"): OrchestratorRecord {
  return {
    id,
    name: id,
    role,
    scope: { groupIds: [], ticketIds: [] },
    policyOverride: {},
    cardId: null,
    state: "running",
    createdAt: "2026-10-08T00:00:00.000Z",
  };
}

await store.setBoardOrchestrators(SBX, [
  record("main", "main"),
  record("infra", "extra"),
]);

const MAIN = mintOrchestratorToken({ boardKey: SBX, orchestratorId: "main" });
const INFRA = mintOrchestratorToken({ boardKey: SBX, orchestratorId: "infra" });
const STRANGER = mintOrchestratorToken({
  boardKey: SBX,
  orchestratorId: "stranger",
});

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/orchestrator`;
after(() => {
  server.close();
  env.cleanup();
});

async function call(
  method: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/state`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { "x-orchestrator-token": token }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

const stateOf = (id: string) =>
  store.getBoard(SBX)!.orchestrators.find((r) => r.id === id)!;

void test("read_state answers an empty state before the first write", async () => {
  const reply = await call("GET", MAIN);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, {
    markdown: "",
    updatedAt: null,
    handoffReady: false,
  });
});

void test("write_state stores the markdown on the record and read_state returns it", async () => {
  const put = await call("PUT", MAIN, { markdown: "# State\n- group a: open" });
  assert.equal(put.status, 200);
  assert.equal(put.body.handoffReady, false);
  assert.equal(typeof put.body.updatedAt, "string");
  const reply = await call("GET", MAIN);
  assert.equal(reply.body.markdown, "# State\n- group a: open");
  assert.equal(reply.body.updatedAt, put.body.updatedAt);
  assert.equal(stateOf("main").stateMarkdown, "# State\n- group a: open");
});

void test("handoffReady is stored when given and reset to false when a later write omits it", async () => {
  await call("PUT", MAIN, { markdown: "s", handoffReady: true });
  assert.equal((await call("GET", MAIN)).body.handoffReady, true);
  assert.equal(stateOf("main").handoffReady, true);
  await call("PUT", MAIN, { markdown: "s2" });
  assert.equal((await call("GET", MAIN)).body.handoffReady, false);
});

void test("each orchestrator reads and writes only its own record", async () => {
  await call("PUT", MAIN, { markdown: "main state" });
  const infra = await call("GET", INFRA);
  assert.equal(infra.body.markdown, "");
  await call("PUT", INFRA, { markdown: "infra state" });
  assert.equal((await call("GET", MAIN)).body.markdown, "main state");
  assert.equal((await call("GET", INFRA)).body.markdown, "infra state");
});

void test("a markdown body of 65536 bytes is accepted and 65537 bytes is 400 state-too-large", async () => {
  const ok = await call("PUT", MAIN, { markdown: "a".repeat(65536) });
  assert.equal(ok.status, 200);
  const over = await call("PUT", MAIN, { markdown: "a".repeat(65537) });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, "state-too-large");
});

void test("the limit counts UTF-8 bytes and not characters", async () => {
  const fits = await call("PUT", MAIN, { markdown: "é".repeat(32768) });
  assert.equal(fits.status, 200);
  const over = await call("PUT", MAIN, { markdown: "é".repeat(32769) });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, "state-too-large");
});

void test("a refused write leaves the stored state as it was", async () => {
  await call("PUT", MAIN, { markdown: "kept" });
  await call("PUT", MAIN, { markdown: "b".repeat(70000) });
  assert.equal((await call("GET", MAIN)).body.markdown, "kept");
});

void test("a body with no markdown or a wrong type is a 400", async () => {
  assert.equal((await call("PUT", MAIN, {})).status, 400);
  assert.equal((await call("PUT", MAIN, { markdown: 5 })).status, 400);
  assert.equal(
    (await call("PUT", MAIN, { markdown: "x", handoffReady: "yes" })).status,
    400,
  );
});

void test("a token whose orchestrator has no record is 404 unknown-orchestrator on both routes", async () => {
  for (const method of ["GET", "PUT"]) {
    const reply = await call(
      method,
      STRANGER,
      method === "PUT" ? { markdown: "x" } : undefined,
    );
    assert.equal(reply.status, 404, method);
    assert.equal(reply.body.error, "unknown-orchestrator", method);
  }
});

void test("no token is 401", async () => {
  assert.equal((await call("GET", null)).status, 401);
  assert.equal((await call("PUT", null, { markdown: "x" })).status, 401);
});

void test("each call is recorded once under its tool name", async () => {
  const before = store.listOrchestrationEvents(SBX, 0, 5000).length;
  await call("GET", MAIN);
  await call("PUT", MAIN, { markdown: "rec" });
  const rows = store
    .listOrchestrationEvents(SBX, 0, 5000)
    .slice(before)
    .filter((e) => e.kind === "tool_call");
  assert.deepEqual(
    rows.map((e) => e.data.tool),
    ["read_state", "write_state"],
  );
});
