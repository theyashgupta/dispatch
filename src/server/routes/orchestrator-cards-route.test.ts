import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  Card,
  OrchestrationEvent,
  OrchestratorRecord,
} from "../../shared/types.js";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { seedPlaybooks, createPlaybook } =
  await import("../services/infra/playbooks.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { sessionStarter } =
  await import("../services/orchestration/start-session.js");
const { tempRepoWithWorkspace } =
  await import("../test-support/git-fixtures.js");
const { startedGroup } = await import("../test-support/group-fixtures.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
const fixture = await tempRepoWithWorkspace();
const repo = fixture.repo;
const starts: string[] = [];
sessionStarter.start = (id) => {
  starts.push(id);
  return Promise.resolve();
};
setOrchestrationConfig({ linearApiKey: "" });
await store.load();
for (const key of [SBX, OTH]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories:
      key === SBX ? [{ path: repo, baseBranch: "main", checkCommand: "" }] : [],
    linearTeamKeys: [],
  });
}
await seedPlaybooks();

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
app.use("/api", express.json(), boardsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  fs.rmSync(fixture.root, { recursive: true, force: true });
  env.cleanup();
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  method: string,
  route: string,
  token?: string,
  body?: unknown,
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

function toolCalls(): OrchestrationEvent[] {
  return store
    .listOrchestrationEvents(SBX, 0, 10_000)
    .filter((e) => e.kind === "tool_call");
}

/** Run one accepted read and return the single `tool_call` row it appended. */
async function read(
  route: string,
): Promise<{ reply: Reply; row: OrchestrationEvent }> {
  const before = toolCalls().length;
  const reply = await call("GET", route, TOKEN);
  await waitFor(
    () => Promise.resolve(toolCalls().length > before),
    2000,
    "tool_call row",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(toolCalls().length, before + 1);
  return { reply, row: toolCalls().at(-1)! };
}

const minted = await call("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;
const revoked = await call("POST", "/boards/SBX/orchestrators/orc-old/token");
const REVOKED = revoked.body.token as string;
await call("DELETE", "/boards/SBX/orchestrators/orc-old/token");

type Summary = { name: string; when: string; source: string };

void test("list_playbooks answers six seeded playbooks and a user playbook", async () => {
  const made = await createPlaybook({
    name: "My notes",
    body: "## Rules\n{extra}\n",
  });
  assert.equal(made.ok, true);
  const { reply, row } = await read("/orchestrator/playbooks");
  assert.equal(reply.status, 200);
  const playbooks = reply.body.playbooks as Summary[];
  const seeded = playbooks.filter((p) => p.source === "seeded");
  assert.equal(seeded.length, 6);
  for (const p of seeded) assert.ok(p.when.length > 0, p.name);
  const mine = playbooks.find((p) => p.name === "My notes");
  assert.equal(mine?.source, "user");
  assert.equal(mine?.when, "");
  assert.equal(row.data.tool, "list_playbooks");
  assert.equal(row.data.result, `${playbooks.length} playbooks`);
});

void test("list_playbooks skips a playbook whose body holds the status marker", async () => {
  fs.writeFileSync(
    path.join(env.dispatchDir, "playbooks", "marked.md"),
    "---\nname: Marked one\n---\n## Rules\nDISPATCH_STATUS: x\n",
  );
  const { reply } = await read("/orchestrator/playbooks");
  const names = (reply.body.playbooks as Summary[]).map((p) => p.name);
  assert.equal(names.includes("Marked one"), false);
});

void test("get_rulebook answers the rule book text and its size", async () => {
  const { reply, row } = await read("/orchestrator/rulebook");
  assert.equal(reply.status, 200);
  const markdown = reply.body.markdown as string;
  assert.ok(markdown.startsWith("# Orchestration rule book"));
  assert.equal(reply.body.bytes, Buffer.byteLength(markdown, "utf8"));
  assert.equal(row.data.tool, "get_rulebook");
  assert.equal(row.data.result, `${reply.body.bytes} bytes`);
});

for (const route of ["/orchestrator/playbooks", "/orchestrator/rulebook"]) {
  void test(`${route} refuses a call with no token or a revoked token`, async () => {
    const none = await call("GET", route);
    assert.equal(none.status, 401);
    assert.equal(none.body.error, "orchestrator-token-required");
    const old = await call("GET", route, REVOKED);
    assert.equal(old.status, 401);
    assert.equal(old.body.error, "orchestrator-token-invalid");
  });
}

/** Run one accepted or refused `start_card` call and return its reply with the single `tool_call` row. */
async function startCard(
  cardId: string,
  body: unknown,
  token = TOKEN,
): Promise<{ reply: Reply; row: OrchestrationEvent }> {
  const before = toolCalls().length;
  const reply = await call(
    "POST",
    `/orchestrator/cards/${cardId}/start`,
    token,
    body,
  );
  await waitFor(
    () => Promise.resolve(toolCalls().length > before),
    2000,
    "tool_call row",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(toolCalls().length, before + 1);
  return { reply, row: toolCalls().at(-1)! };
}

const PLAYBOOK = "Write code directly";

async function setCap(concurrencyCap: number): Promise<void> {
  await store.setBoardPolicy(SBX, {
    ...store.getBoard(SBX)!.policy,
    concurrencyCap,
  });
}

async function launchedRunning(): Promise<Card> {
  const card = await store.createLocalCard(SBX, "running", "");
  await store.completeStart(card.id, undefined, {
    workspacePath: `/tmp/ws-${card.id}`,
    tmuxSession: `dsp-${card.id}`,
    branch: card.id,
  });
  await store.setOrchestratorFields(card.id, {
    launch: { playbook: PLAYBOOK, direction: "" },
  });
  return store.getCard(card.id)!;
}

function assertRefused(
  { reply, row }: { reply: Reply; row: OrchestrationEvent },
  status: number,
  error: string,
): void {
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  assert.equal(reply.body.error, error);
  assert.equal(row.data.tool, "start_card");
  assert.equal(row.data.status, status);
  assert.equal(row.data.result, error);
}

void test("start_card answers 202 with the card and the playbook, and records one tool_call row", async () => {
  const card = await store.createLocalCard(SBX, "fix typo", "");
  const startsBefore = starts.length;
  const { reply, row } = await startCard(card.id, {
    playbook: PLAYBOOK,
    direction: "fix the typo",
  });
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  assert.deepEqual(reply.body, {
    started: true,
    cardId: card.id,
    playbook: PLAYBOOK,
  });
  assert.deepEqual(starts.slice(startsBefore), [card.id]);
  assert.deepEqual(store.getCard(card.id)?.launch, {
    playbook: PLAYBOOK,
    direction: "fix the typo",
  });
  assert.equal(row.data.tool, "start_card");
  assert.equal(row.data.status, 202);
  assert.equal(row.data.result, `started ${PLAYBOOK}`);
  assert.equal(row.cardId, card.id);
});

void test("start_card refuses a group card, the Board Orchestrator playbook and an unknown playbook with 400", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  assertRefused(
    await startCard(g.id, { playbook: PLAYBOOK }),
    400,
    "not-ticket-card",
  );
  const card = await store.createLocalCard(SBX, "refused", "");
  assertRefused(
    await startCard(card.id, { playbook: "Board Orchestrator" }),
    400,
    "orchestrator-playbook",
  );
  assertRefused(
    await startCard(card.id, { playbook: "No such playbook" }),
    400,
    "unknown-playbook",
  );
  assert.equal(store.getCard(card.id)?.launch, undefined);
});

void test("start_card refuses a Done card with 409 and a running card with already-started", async () => {
  const done = await store.createLocalCard(SBX, "done", "");
  await store.moveCardManual(done.id, "done");
  const refused = await startCard(done.id, { playbook: PLAYBOOK });
  assert.equal(refused.reply.status, 409, JSON.stringify(refused.reply.body));
  assert.equal(refused.row.data.status, 409);
  assert.equal(store.getCard(done.id)?.launch, undefined);
  const running = await launchedRunning();
  assertRefused(
    await startCard(running.id, { playbook: PLAYBOOK }),
    409,
    "already-started",
  );
});

void test("start_card refuses a bad body with 400 and writes nothing", async () => {
  const card = await store.createLocalCard(SBX, "bad body", "");
  assertRefused(await startCard(card.id, {}), 400, "invalid-playbook");
  assertRefused(
    await startCard(card.id, { playbook: PLAYBOOK, repos: [] }),
    400,
    "invalid-repos",
  );
  assertRefused(
    await startCard(card.id, {
      playbook: PLAYBOOK,
      repos: [{ path: "/tmp/elsewhere", base: "main" }],
    }),
    400,
    "unknown-repository",
  );
  assert.equal(store.getCard(card.id)?.launch, undefined);
});

void test("start_card refuses a card of another board and a card of another owner", async () => {
  const foreign = await store.createLocalCard(OTH, "foreign", "");
  assertRefused(
    await startCard(foreign.id, { playbook: PLAYBOOK }),
    403,
    "other-board",
  );
  const owned = await store.createLocalCard(SBX, "owned by an extra", "");
  const board = store.getBoard(SBX)!;
  const extra: OrchestratorRecord = {
    id: "extra-1",
    name: "extra-1",
    role: "extra",
    scope: { groupIds: [], ticketIds: [owned.id] },
    policyOverride: {},
    cardId: null,
    state: "stopped",
    createdAt: "2026-10-07T00:00:00.000Z",
  };
  await store.setBoardOrchestrators(SBX, [...board.orchestrators, extra]);
  assertRefused(
    await startCard(owned.id, { playbook: PLAYBOOK }),
    403,
    "other-owner",
  );
  for (const card of [foreign, owned]) {
    assert.equal(store.getCard(card.id)?.launch, undefined);
  }
});

void test("start_card answers 404 unknown-card for the hidden orchestrator card and an unknown id", async () => {
  const hidden = await store.createOrchestratorCard(
    SBX,
    "Orchestrator: orc-sbx",
    "orc-sbx",
  );
  assertRefused(
    await startCard(hidden.id, { playbook: PLAYBOOK }),
    404,
    "unknown-card",
  );
  assertRefused(
    await startCard("SBX-9999", { playbook: PLAYBOOK }),
    404,
    "unknown-card",
  );
  assert.equal(store.getCard(hidden.id)?.launch, undefined);
});

void test("start_card at the cap answers 403 policy-refused, then starts once a slot is free", async () => {
  await launchedRunning();
  const loops = (await call("GET", "/orchestrator/policy", TOKEN)).body
    .runningLoops as number;
  await setCap(loops);
  const card = await store.createLocalCard(SBX, "at the cap", "");
  const startsBefore = starts.length;
  const refused = await startCard(card.id, { playbook: PLAYBOOK });
  assertRefused(refused, 403, "policy-refused");
  assert.equal(starts.length, startsBefore);
  assert.equal(store.getCard(card.id)?.launch, undefined);
  await setCap(loops + 1);
  const { reply } = await startCard(card.id, { playbook: PLAYBOOK });
  assert.equal(reply.status, 202);
  await setCap(10);
});

void test("start_group at the cap counts a launched card that runs", async () => {
  await launchedRunning();
  const loops = (await call("GET", "/orchestrator/policy", TOKEN)).body
    .runningLoops as number;
  await setCap(loops);
  const a = await store.createLocalCard(SBX, "member a", "");
  const b = await store.createLocalCard(SBX, "member b", "");
  const made = await store.createGroupCard(SBX, "idle group", [a.id, b.id]);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  const before = toolCalls().length;
  const reply = await call(
    "POST",
    `/orchestrator/groups/${made.card.id}/start`,
    TOKEN,
  );
  assert.equal(reply.status, 403, JSON.stringify(reply.body));
  assert.equal(reply.body.error, "policy-refused");
  await waitFor(
    () => Promise.resolve(toolCalls().length > before),
    2000,
    "tool_call row",
  );
  await setCap(10);
});

void test("two parallel start_card calls on one card answer one 202 and one 409 already-started, each with a tool_call row", async () => {
  const card = await store.createLocalCard(SBX, "parallel start", "");
  const startsBefore = starts.length;
  const rowsBefore = toolCalls().length;
  sessionStarter.start = (id) => {
    starts.push(id);
    store.beginStart(id);
    return Promise.resolve();
  };
  try {
    const playbooks = [PLAYBOOK, "Superpowers"];
    const replies = await Promise.all(
      playbooks.map((playbook) =>
        call("POST", `/orchestrator/cards/${card.id}/start`, TOKEN, {
          playbook,
        }),
      ),
    );
    await waitFor(
      () => Promise.resolve(toolCalls().length >= rowsBefore + 2),
      2000,
      "tool_call rows",
    );
    assert.deepEqual(replies.map((r) => r.status).sort(), [202, 409]);
    const won = replies.findIndex((r) => r.status === 202);
    assert.equal(replies[1 - won].body.error, "already-started");
    assert.deepEqual(starts.slice(startsBefore), [card.id]);
    assert.equal(store.getCard(card.id)?.launch?.playbook, playbooks[won]);
    const rows = toolCalls().slice(rowsBefore);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.data.status).sort(), [202, 409]);
  } finally {
    store.endStart(card.id);
    sessionStarter.start = (id) => {
      starts.push(id);
      return Promise.resolve();
    };
  }
});
