import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { Board, BoardKey, BoardPolicy } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { boardPolicyRouter } = await import("./board-policy.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const PLC = parseBoardKey("PLC") as BoardKey;
await store.load();
await store.createBoard({
  key: PLC,
  name: "Policy",
  workspaceRoot: "/plc/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const app = express();
app.use("/api", express.json(), boardPolicyRouter, httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

interface Reply {
  status: number;
  text: string;
  body: { board: Board; error?: string };
}

async function put(route: string, body: unknown): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Reply["body"] };
}

const VALID: BoardPolicy = {
  roadmapApproval: "rules",
  concurrencyCap: 5,
  loopModel: "sonnet",
  orchestratorModel: "opus",
  handoffPercent: 40,
  handoffHardPercent: 70,
  usageLimit: "stop",
  shipRights: "open_prs",
  budgetPerGroup: 25.5,
  supervisor: "off",
};

function stored(): BoardPolicy | undefined {
  return store.getBoard(PLC)?.policy;
}

async function expectRefusal(
  body: unknown,
  status: number,
  error: string,
): Promise<void> {
  const before = JSON.stringify(stored());
  const got = await put("/boards/PLC/policy", body);
  assert.equal(got.status, status, got.text);
  assert.equal(got.body.error, error);
  assert.equal(
    JSON.stringify(stored()),
    before,
    "a refused body writes nothing",
  );
}

test("a valid full policy answers 200, the board carries it and the store holds it", async () => {
  const before = stored();
  assert.notDeepEqual(before, VALID);
  const got = await put("/boards/PLC/policy", VALID);
  assert.equal(got.status, 200, got.text);
  assert.equal(got.body.board.key, "PLC");
  assert.deepEqual(got.body.board.policy, VALID);
  assert.deepEqual(stored(), VALID);
});

test("a body that is not an object answers 400 invalid-policy and writes nothing", async () => {
  await expectRefusal([], 400, "invalid-policy");
});

test("an unknown field answers 400 and writes nothing", async () => {
  await expectRefusal({ ...VALID, extra: 1 }, 400, "unknown-field");
});

test("usageLimit credits answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, usageLimit: "credits" },
    400,
    "invalid-usageLimit",
  );
});

test("a negative concurrencyCap answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, concurrencyCap: -1 },
    400,
    "invalid-concurrencyCap",
  );
});

test("handoffPercent 101 answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, handoffPercent: 101 },
    400,
    "invalid-handoffPercent",
  );
});

test("handoffHardPercent below handoffPercent answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, handoffPercent: 60, handoffHardPercent: 59 },
    400,
    "hard-below-handoff",
  );
});

test("an unknown board key answers 404", async () => {
  const got = await put("/boards/NOPE/policy", VALID);
  assert.equal(got.status, 404, got.text);
  assert.equal(got.body.error, "unknown-board");
});
