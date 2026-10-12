import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  Board,
  BoardKey,
  OrchestrationEvent,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");

const realHome = fs.realpathSync(env.home);
const SBX = parseBoardKey("SBX") as BoardKey;
const workspaces = path.join(env.root, "workspaces");
fs.mkdirSync(workspaces, { recursive: true });
setOrchestrationConfig({ linearApiKey: "", workspaceRoot: workspaces });
await store.load();
await store.createBoard({
  key: SBX,
  name: "SBX",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
app.use("/api", express.json(), boardsRouter);
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
  body: Record<string, unknown>;
}

async function raw(
  method: string,
  route: string,
  body?: unknown,
  token?: string,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { "x-orchestrator-token": token }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

const minted = await raw("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

const toolCalls = (): OrchestrationEvent[] =>
  store
    .listOrchestrationEvents(SBX, 0, 10_000)
    .filter((e) => e.kind === "tool_call");

const boardKeys = () => store.listBoards().map((b) => b.key);

/** Run one create_board call with the SBX token and return its reply with the `tool_call` row. */
async function create(
  body: unknown,
): Promise<{ reply: Reply; row: OrchestrationEvent }> {
  const before = toolCalls().length;
  const reply = await raw("POST", "/orchestrator/boards", body, TOKEN);
  await waitFor(
    () => Promise.resolve(toolCalls().length > before),
    2000,
    "tool_call row",
  );
  return { reply, row: toolCalls().at(-1)! };
}

void test("create_board with a name only answers 201 with the board and the link and makes the folder", async () => {
  const { reply, row } = await create({ name: "Payments" });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.key, undefined);
  assert.equal(reply.body.link, "/boards/PAYMEN");
  const board = reply.body.board as Board;
  assert.equal(board.key, "PAYMEN");
  assert.equal(board.workspaceRoot, path.join(workspaces, "PAYMEN"));
  assert.deepEqual(board.repositories, []);
  assert.ok(fs.statSync(board.workspaceRoot).isDirectory());
  assert.ok(boardKeys().includes("PAYMEN" as BoardKey));
  assert.equal(row.data.tool, "create_board");
  assert.equal(row.data.status, 201);
  assert.equal(row.data.result, "PAYMEN");
  const listed = await raw("GET", "/boards");
  const keys = (listed.body.boards as Board[]).map((b) => b.key);
  assert.ok(keys.includes("PAYMEN" as BoardKey));
});

void test("create_board takes a folder and repository paths with the default check command", async () => {
  const folder = path.join(realHome, "own-folder");
  const repo = path.join(folder, "api");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const { reply } = await create({
    name: "Own folder",
    folder,
    repositories: [repo, repo],
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  const board = reply.body.board as Board;
  assert.equal(board.workspaceRoot, folder);
  assert.deepEqual(
    board.repositories.map((r) => [r.path, r.baseBranch, r.checkCommand]),
    [[repo, null, "npm run check"]],
  );
});

void test("create_board refuses a name over 100 characters or with a newline with invalid-name and stores nothing", async () => {
  const before = boardKeys();
  for (const name of ["a".repeat(101), "two\nlines"]) {
    const { reply } = await create({ name });
    assert.equal(reply.status, 400);
    assert.equal(reply.body.code, "invalid-name");
  }
  assert.deepEqual(boardKeys(), before);
});

void test("create_board refuses a blank name with missing-name and stores nothing", async () => {
  const before = boardKeys();
  for (const name of ["", "   "]) {
    const { reply, row } = await create({ name });
    assert.equal(reply.status, 400);
    assert.equal(reply.body.code, "missing-name");
    assert.equal(row.data.status, 400);
  }
  const none = await create({});
  assert.equal(none.reply.body.code, "missing-name");
  assert.deepEqual(boardKeys(), before);
});

void test("create_board gives the typed refusals of POST /boards for a bad folder and a bad repository", async () => {
  const before = boardKeys();
  const relative = await create({ name: "Rel", folder: "relative/dir" });
  assert.equal(relative.reply.status, 400);
  assert.equal(relative.reply.body.code, "folder-missing");
  const absent = await create({
    name: "Gone",
    folder: path.join(realHome, "does-not-exist"),
  });
  assert.equal(absent.reply.body.code, "folder-missing");
  const badRepo = await create({ name: "Bad", repositories: ["not/absolute"] });
  assert.equal(badRepo.reply.body.code, "folder-missing");
  assert.deepEqual(boardKeys(), before);
});

void test("create_board refuses a folder or a repository outside the home folder with 403 and stores nothing", async () => {
  const before = boardKeys();
  const outsideHome = "/etc";
  for (const body of [
    { name: "Out", folder: outsideHome },
    { name: "Out", repositories: [outsideHome] },
  ]) {
    const { reply, row } = await create(body);
    assert.equal(reply.status, 403, JSON.stringify(reply.body));
    assert.equal(reply.body.error, "outside-home");
    assert.equal(row.data.status, 403);
  }
  assert.deepEqual(boardKeys(), before);
  assert.equal(fs.existsSync(path.join(workspaces, "OUT")), false);
});

void test("create_board with no token is refused with 401 and stores nothing", async () => {
  const before = boardKeys();
  const none = await raw("POST", "/orchestrator/boards", { name: "Ghost" });
  assert.equal(none.status, 401);
  assert.equal(none.body.error, "orchestrator-token-required");
  const bad = await raw(
    "POST",
    "/orchestrator/boards",
    { name: "Ghost" },
    "not-a-token",
  );
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, "orchestrator-token-invalid");
  assert.deepEqual(boardKeys(), before);
});
