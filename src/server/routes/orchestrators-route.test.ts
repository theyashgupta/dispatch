import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  Board,
  BoardKey,
  OrchestratorRecord,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { DISPATCH_DATA_DIR } = await import("../store/data-dir.js");
const { setHooksRuntime, setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { mintOrchestratorToken } =
  await import("../services/orchestration/orchestrator-tokens.js");
const { orchestratorTools } =
  await import("../services/orchestration/orchestrator-session.js");
const express = (await import("express")).default;
const { orchestratorsRouter } = await import("./orchestrators.route.js");
const { refuseOrchestratorTokenOnUserRoute } =
  await import("./orchestrator.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OFF = parseBoardKey("OFF") as BoardKey;
setOrchestrationConfig({ linearApiKey: "" });
setHooksRuntime({ capable: true, port: 4711, statusChannel: "hooks" });
await store.load();
for (const key of [SBX, OFF]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: [],
  });
}
const policy = (key: BoardKey) => (store.getBoard(key) as Board).policy;
await store.setBoardPolicy(SBX, { ...policy(SBX), supervisor: "on" });
await store.setBoardPolicy(OFF, { ...policy(OFF), supervisor: "off" });
const a = await store.createLocalCard(SBX, "member a", "");
const b = await store.createLocalCard(SBX, "member b", "");
const made = await store.createGroupCard(SBX, "infra", [a.id, b.id]);
if (!made.ok) throw new Error("group not created");
const group = made.card;

const keys: string[] = [];
const calls: string[] = [];
orchestratorTools.mcpCommand = () => ({ command: "/node", args: ["mcp"] });
orchestratorTools.start = async (cardId) => {
  calls.push("start");
  await store.completeStart(cardId, undefined, {
    workspacePath: `/sbx/sessions/${cardId}`,
    branch: cardId,
    tmuxSession: `dsp-${cardId}`,
  });
};
orchestratorTools.keys = (target, pressed) => {
  keys.push(`${target} ${pressed.join(",")}`);
  return Promise.resolve();
};
orchestratorTools.send = (_card, _session, text) => {
  calls.push(`send ${text}`);
  return Promise.resolve("confirmed");
};
orchestratorTools.atPrompt = () => Promise.resolve(true);
orchestratorTools.hasSession = () => Promise.resolve(true);
orchestratorTools.relaunch = () => {
  calls.push("relaunch");
  return Promise.resolve("launched");
};
orchestratorTools.stopWait = { totalMs: 50, pollMs: 5 };

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

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function call(
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

const records = (key: BoardKey = SBX) =>
  (store.getBoard(key) as Board).orchestrators;
const stateOf = (id: string) => records().find((r) => r.id === id)?.state;
const settle = (id: string, state: OrchestratorRecord["state"]) =>
  waitFor(() => Promise.resolve(stateOf(id) === state), 2000, `${id} ${state}`);
const R = "/boards/SBX/orchestrators";

void test("list answers an empty board", async () => {
  const reply = await call("GET", R);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, { orchestrators: [] });
});

void test("add accepts a main and an extra and lists both with their session view", async () => {
  const main = await call("POST", R, {
    id: "lead",
    name: "Lead",
    role: "main",
  });
  assert.equal(main.status, 201);
  assert.equal((main.body.orchestrator as OrchestratorRecord).state, "stopped");
  const extra = await call("POST", R, {
    id: "infra",
    name: "Infra",
    role: "extra",
    scope: { groupIds: [group.id], ticketIds: [] },
    policyOverride: { concurrencyCap: 2, shipRights: "none" },
  });
  assert.equal(extra.status, 201);
  const listed = await call("GET", R);
  const rows = listed.body.orchestrators as { id: string; session: unknown }[];
  assert.deepEqual(
    rows.map((r) => r.id),
    ["lead", "infra"],
  );
  assert.equal(rows[0]?.session, null);
});

void test("add refuses bad bodies before any write", async () => {
  const before = JSON.stringify(records());
  const cases: [unknown, number, string][] = [
    [{ id: "Bad", name: "x", role: "main" }, 400, "invalid-id"],
    [{ id: "a", name: "x", role: "main" }, 400, "invalid-id"],
    [{ id: "okid", name: "", role: "main" }, 400, "invalid-name"],
    [{ id: "okid", name: "x", role: "boss" }, 400, "invalid-role"],
    [
      { id: "okid", name: "x", role: "extra", model: "opus" },
      400,
      "unknown-field",
    ],
    [
      {
        id: "okid",
        name: "x",
        role: "extra",
        policyOverride: { model: "opus" },
      },
      400,
      "unknown-field",
    ],
    [
      {
        id: "okid",
        name: "x",
        role: "extra",
        policyOverride: { concurrencyCap: -1 },
      },
      400,
      "invalid-concurrencyCap",
    ],
    [
      {
        id: "okid",
        name: "x",
        role: "extra",
        policyOverride: { concurrencyCap: 21 },
      },
      400,
      "invalid-concurrencyCap",
    ],
    [
      {
        id: "okid",
        name: "x",
        role: "extra",
        scope: { groupIds: [""], ticketIds: [] },
      },
      400,
      "invalid-groupIds",
    ],
    [{ id: "okid", name: "x", role: "main" }, 409, "main-exists"],
    [
      {
        id: "lead",
        name: "x",
        role: "extra",
        scope: { groupIds: [], ticketIds: [] },
      },
      409,
      "duplicate-id",
    ],
    [
      {
        id: "two",
        name: "x",
        role: "extra",
        scope: { groupIds: [group.id], ticketIds: [] },
      },
      409,
      "group-owned",
    ],
    [
      {
        id: "two",
        name: "x",
        role: "extra",
        scope: { groupIds: ["NOPE-9"], ticketIds: [] },
      },
      400,
      "unknown-card",
    ],
  ];
  for (const [body, status, error] of cases) {
    const reply = await call("POST", R, body);
    assert.equal(reply.status, status, JSON.stringify(body));
    assert.equal(reply.body.error, error, JSON.stringify(body));
  }
  assert.equal(JSON.stringify(records()), before);
});

void test("group-owned names the owner in the body", async () => {
  const reply = await call("POST", R, {
    id: "two",
    name: "Two",
    role: "extra",
    scope: { groupIds: [group.id], ticketIds: [] },
  });
  assert.equal(reply.body.owner, "infra");
});

void test("an extra override wider than the board cap is 400 wider-override with the field on add and on edit, writing nothing", async () => {
  const kept = policy(SBX);
  await store.setBoardPolicy(SBX, { ...kept, concurrencyCap: 3 });
  const ticket = await store.createLocalCard(SBX, "wide ticket", "");
  try {
    const before = JSON.stringify(records());
    const added = await call("POST", R, {
      id: "wide",
      name: "Wide",
      role: "extra",
      scope: { groupIds: [], ticketIds: [ticket.id] },
      policyOverride: { concurrencyCap: 4 },
    });
    assert.equal(added.status, 400);
    assert.equal(added.body.error, "wider-override");
    assert.equal(added.body.field, "concurrencyCap");
    assert.equal(JSON.stringify(records()), before);

    const edited = await call("PATCH", `${R}/infra`, {
      policyOverride: { concurrencyCap: 4 },
    });
    assert.equal(edited.status, 400);
    assert.equal(edited.body.error, "wider-override");
    assert.equal(edited.body.field, "concurrencyCap");
    assert.equal(JSON.stringify(records()), before);
  } finally {
    await store.setBoardPolicy(SBX, kept);
  }
});

void test("a stored override made wider by a later board policy change blocks no edit that sends no override", async () => {
  const kept = policy(SBX);
  const keptRecords = records();
  await store.setBoardPolicy(SBX, { ...kept, concurrencyCap: 3 });
  try {
    const set = await call("PATCH", `${R}/infra`, {
      policyOverride: { concurrencyCap: 3 },
    });
    assert.equal(set.status, 200);
    await store.setBoardPolicy(SBX, { ...kept, concurrencyCap: 2 });
    const renamed = await call("PATCH", `${R}/infra`, { name: "Infra x" });
    assert.equal(renamed.status, 200);
    assert.equal(
      (renamed.body.orchestrator as OrchestratorRecord).name,
      "Infra x",
    );
    const resent = await call("PATCH", `${R}/infra`, {
      name: "Infra y",
      policyOverride: { concurrencyCap: 3 },
    });
    assert.equal(resent.status, 400);
    assert.equal(resent.body.error, "wider-override");
    assert.equal(resent.body.field, "concurrencyCap");
  } finally {
    await store.setBoardPolicy(SBX, kept);
    await store.setBoardOrchestrators(SBX, keptRecords);
  }
});

void test("an unknown board is 404 and an unknown orchestrator is 404", async () => {
  assert.equal((await call("GET", "/boards/ZZZ/orchestrators")).status, 404);
  const reply = await call("POST", `${R}/ghost/start`);
  assert.equal(reply.status, 404);
  assert.equal(reply.body.error, "unknown-orchestrator");
});

void test("a malformed orchestrator id is 400 invalid-id on every id route", async () => {
  for (const [method, suffix] of [
    ["PATCH", ""],
    ["DELETE", ""],
    ["POST", "/start"],
    ["POST", "/stop"],
    ["POST", "/resume"],
  ] as const) {
    for (const id of ["Ghost", "x", `a${"b".repeat(30)}`]) {
      const reply = await call(method, `${R}/${id}${suffix}`, { name: "N" });
      assert.equal(reply.status, 400, `${method} ${id}${suffix}`);
      assert.equal(reply.body.error, "invalid-id");
    }
  }
});

void test("edit changes the name and the override, and refuses a model field or an empty patch", async () => {
  const ok = await call("PATCH", `${R}/infra`, {
    name: "Infra team",
    policyOverride: { concurrencyCap: 1 },
  });
  assert.equal(ok.status, 200);
  assert.equal((ok.body.orchestrator as OrchestratorRecord).name, "Infra team");
  for (const body of [{ model: "opus" }, { role: "main" }, {}]) {
    assert.equal((await call("PATCH", `${R}/infra`, body)).status, 400);
  }
  assert.equal(records().find((r) => r.id === "infra")?.name, "Infra team");
});

void test("start is refused on a board with supervisor off", async () => {
  await call("POST", "/boards/OFF/orchestrators", {
    id: "lead",
    name: "Lead",
    role: "main",
  });
  const reply = await call("POST", "/boards/OFF/orchestrators/lead/start");
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "policy-refused");
  assert.equal(reply.body.reason, "supervisor-off");
  assert.equal(records(OFF)[0]?.cardId, null);
  assert.equal(calls.includes("start"), false);
});

void test("start answers 202 with the starting record and ends running", async () => {
  const reply = await call("POST", `${R}/lead/start`);
  assert.equal(reply.status, 202);
  assert.equal(
    (reply.body.orchestrator as OrchestratorRecord).state,
    "starting",
  );
  await settle("lead", "running");
  assert.equal(
    (await call("POST", `${R}/lead/start`)).body.error,
    "orchestrator-running",
  );
  assert.equal((await call("DELETE", `${R}/lead`)).status, 409);
});

void test("stop answers 202, presses Escape then /exit, and ends stopped without a kill", async () => {
  calls.length = 0;
  const reply = await call("POST", `${R}/lead/stop`);
  assert.equal(reply.status, 202);
  assert.equal(
    (reply.body.orchestrator as OrchestratorRecord).state,
    "stopping",
  );
  await settle("lead", "stopped");
  assert.equal(keys.length, 1);
  assert.match(keys[0] ?? "", /^=dsp-.+: Escape$/);
  assert.deepEqual(calls, ["send /exit"]);
});

void test("resume answers 202 and ends running", async () => {
  calls.length = 0;
  const reply = await call("POST", `${R}/lead/resume`);
  assert.equal(reply.status, 202);
  await settle("lead", "running");
  assert.deepEqual(calls, ["relaunch"]);
});

void test("every state changing route refuses an orchestrator token and changes nothing", async () => {
  const token = mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "lead",
  });
  const before = JSON.stringify(records());
  const attempts: [string, string, unknown][] = [
    [
      "POST",
      R,
      {
        id: "newone",
        name: "New",
        role: "extra",
        scope: { groupIds: [], ticketIds: [] },
      },
    ],
    ["PATCH", `${R}/infra`, { name: "Hijack" }],
    ["DELETE", `${R}/infra`, undefined],
    ["POST", `${R}/infra/start`, undefined],
    ["POST", `${R}/lead/stop`, undefined],
    ["POST", `${R}/lead/resume`, undefined],
  ];
  calls.length = 0;
  for (const [method, route, body] of attempts) {
    const reply = await call(method, route, body, token);
    assert.equal(reply.status, 403, `${method} ${route}`);
    assert.equal(reply.body.error, "orchestrator-token-on-user-route");
  }
  assert.equal(JSON.stringify(records()), before);
  assert.deepEqual(calls, []);
  assert.equal((await call("GET", R, undefined, token)).status, 200);
});

void test("remove deletes a stopped extra and answers 204", async () => {
  const reply = await call("DELETE", `${R}/infra`);
  assert.equal(reply.status, 204);
  assert.equal(
    records().some((r) => r.id === "infra"),
    false,
  );
});

void test("a start whose mcp config write fails answers the JSON error shape, never an HTML page", async () => {
  const FLR = parseBoardKey("FLR") as BoardKey;
  await store.createBoard({
    key: FLR,
    name: "FLR",
    workspaceRoot: "/flr/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
  await store.setBoardPolicy(FLR, { ...policy(FLR), supervisor: "on" });
  assert.equal(
    (
      await call("POST", "/boards/FLR/orchestrators", {
        id: "main",
        name: "Main",
        role: "main",
        scope: { groupIds: [], ticketIds: [] },
        policyOverride: {},
      })
    ).status,
    201,
  );
  const dir = path.join(DISPATCH_DATA_DIR, "orchestrators");
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o000);
  let reply: Reply;
  try {
    reply = await call("POST", "/boards/FLR/orchestrators/main/start");
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.equal(reply.status, 500);
  assert.deepEqual(reply.body, { error: "orchestrator-start-failed" });
  const record = records(FLR)[0];
  assert.equal(record?.state, "stopped");
  assert.ok(record?.cardId);
  assert.equal(
    store.listAllCards(FLR).filter((c) => c.source === "orchestrator").length,
    1,
  );
});
