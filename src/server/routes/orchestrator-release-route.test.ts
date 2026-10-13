import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  ClaudeAccountSummary,
  OrchestrationEvent,
} from "../../shared/types.js";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { upsertAccount } =
  await import("../services/orchestration/claude-accounts.js");
const { safeAccount } =
  await import("../services/orchestration/orchestrator-read.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const NOB = parseBoardKey("NOB") as BoardKey;
const BDV = parseBoardKey("BDV") as BoardKey;

const roots: string[] = [];
const { gitOutput, tempRepoWithWorkspace } =
  await import("../test-support/git-fixtures.js");

/** A repository whose bare origin holds `package.json` text on main; the push has happened. */
async function repoWithOrigin(packageJson: string): Promise<string> {
  const { root, repo } = await tempRepoWithWorkspace();
  roots.push(root);
  const bare = path.join(root, "origin.git");
  await gitOutput(repo, "init", "-q", "--bare", "-b", "main", bare);
  await gitOutput(repo, "config", "user.name", "t");
  await gitOutput(repo, "config", "user.email", "t@example.com");
  fs.writeFileSync(path.join(repo, "package.json"), packageJson);
  await gitOutput(repo, "add", ".");
  await gitOutput(repo, "commit", "-qm", "package");
  await gitOutput(repo, "remote", "add", "origin", bare);
  await gitOutput(repo, "push", "-q", "origin", "main");
  return repo;
}

const versionJson = (version: string) =>
  `${JSON.stringify({ name: "app", version })}\n`;

const mainRepo = await repoWithOrigin(versionJson("1.2.3"));
fs.writeFileSync(path.join(mainRepo, "package.json"), versionJson("9.9.9"));
await gitOutput(mainRepo, "commit", "-qam", "local only");
const badRepo = await repoWithOrigin(versionJson("1.2"));
const advancedRepo = await repoWithOrigin(versionJson("1.2.3"));
const staleRepo = await repoWithOrigin(versionJson("1.2.3"));

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await store.createBoard({
  key: SBX,
  name: SBX,
  workspaceRoot: "/sbx/sessions",
  repositories: [{ path: mainRepo, baseBranch: "main", checkCommand: "" }],
  linearTeamKeys: [],
});
await store.setBoardPolicy(SBX, {
  ...store.getBoard(SBX)!.policy,
  shipRights: "merge",
});
await store.createBoard({
  key: NOB,
  name: NOB,
  workspaceRoot: "/nob/sessions",
  repositories: [{ path: mainRepo, baseBranch: null, checkCommand: "" }],
  linearTeamKeys: [],
});
for (const [key, repo] of [
  ["ADV", advancedRepo],
  ["STL", staleRepo],
] as const) {
  await store.createBoard({
    key: parseBoardKey(key) as BoardKey,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [{ path: repo, baseBranch: "main", checkCommand: "" }],
    linearTeamKeys: [],
  });
}
await store.createBoard({
  key: BDV,
  name: BDV,
  workspaceRoot: "/bdv/sessions",
  repositories: [{ path: badRepo, baseBranch: "main", checkCommand: "" }],
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
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
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
const nobToken = (await call("POST", "/boards/NOB/orchestrators/orc-nob/token"))
  .body.token as string;
const advToken = (await call("POST", "/boards/ADV/orchestrators/orc-adv/token"))
  .body.token as string;
const stlToken = (await call("POST", "/boards/STL/orchestrators/orc-stl/token"))
  .body.token as string;
const bdvToken = (await call("POST", "/boards/BDV/orchestrators/orc-bdv/token"))
  .body.token as string;
const revoked = await call("POST", "/boards/SBX/orchestrators/orc-old/token");
const REVOKED = revoked.body.token as string;
await call("DELETE", "/boards/SBX/orchestrators/orc-old/token");

const SAFE_KEYS = [
  "id",
  "isDefault",
  "subscriptionType",
  "state",
  "inUse",
  "position",
  "limitedUntil",
  "windows",
].sort();

interface AccountOut {
  id: string;
  isDefault: boolean;
  windows: unknown[];
}

void test("list_accounts answers the active id and the default account with safe fields only", async () => {
  const { reply, row } = await read("/orchestrator/accounts");
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.activeId, "default");
  const accounts = reply.body.accounts as AccountOut[];
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, "default");
  assert.equal(accounts[0].isDefault, true);
  for (const account of accounts) {
    assert.deepEqual(Object.keys(account).sort(), SAFE_KEYS);
  }
  assert.equal(row.data.tool, "list_accounts");
  assert.equal(row.data.result, "1 accounts");
});

void test("list_accounts lists an added account with no email, organization or login time", async () => {
  await upsertAccount({
    id: "11111111-1111-4111-8111-111111111111",
    email: "added@example.com",
    orgId: "org-added",
    orgName: "Org Added",
    subscriptionType: "pro",
    createdAt: "2026-09-02T00:00:00.000Z",
    lastLoginAt: "2026-09-02T00:00:00.000Z",
  });
  const { reply } = await read("/orchestrator/accounts");
  assert.equal(reply.status, 200);
  const accounts = reply.body.accounts as AccountOut[];
  assert.equal(accounts.length, 2);
  for (const account of accounts) {
    assert.deepEqual(Object.keys(account).sort(), SAFE_KEYS);
  }
  assert.doesNotMatch(
    JSON.stringify(reply.body),
    /email|orgName|orgId|lastLoginAt|accessToken|refreshToken|@example/,
  );
});

void test("safeAccount keeps the usage windows and drops every unsafe field", () => {
  const summary: ClaudeAccountSummary = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "added@example.com",
    orgName: "Org Added",
    subscriptionType: "max",
    isDefault: false,
    lastLoginAt: "2026-09-02T00:00:00.000Z",
    usage: {
      status: "ok",
      fetchedAt: "2026-10-14T00:00:00.000Z",
      error: "boom",
      loginExpiresAt: "2026-11-01T00:00:00.000Z",
      windows: [
        {
          kind: "seven_day",
          label: "Weekly",
          percent: 42,
          resetsAt: "2026-10-20T00:00:00.000Z",
          isActive: true,
          periodStart: "2026-10-13T00:00:00.000Z",
          periodEnd: "2026-10-20T00:00:00.000Z",
        },
        {
          kind: "five_hour",
          label: "Session",
          percent: 7,
          resetsAt: null,
          isActive: false,
          periodStart: null,
          periodEnd: null,
        },
      ],
    },
    position: 1,
    state: "available",
    buckets: [],
    limitedUntil: null,
    inUse: false,
  };
  assert.deepEqual(safeAccount(summary), {
    id: "11111111-1111-4111-8111-111111111111",
    isDefault: false,
    subscriptionType: "max",
    state: "available",
    inUse: false,
    position: 1,
    limitedUntil: null,
    windows: [
      {
        kind: "seven_day",
        label: "Weekly",
        percent: 42,
        resetsAt: "2026-10-20T00:00:00.000Z",
      },
      { kind: "five_hour", label: "Session", percent: 7, resetsAt: null },
    ],
  });
});

void test("list_accounts with no token answers 401 and with a revoked token answers 401", async () => {
  const none = await call("GET", "/orchestrator/accounts");
  assert.equal(none.status, 401);
  assert.equal(none.body.error, "orchestrator-token-required");
  const old = await call("GET", "/orchestrator/accounts", REVOKED);
  assert.equal(old.status, 401);
  assert.equal(old.body.error, "orchestrator-token-invalid");
});

const GOOD_BODY = {
  bump: "minor",
  features: ["Release cards", "Account picker"],
  prs: [12, 15],
};

void test("release_prep creates Release v1.3.0 from the origin base, not the local checkout", async () => {
  const before = toolCalls().filter((e) => e.data.tool === "release_prep");
  const reply = await call("POST", "/orchestrator/releases", TOKEN, GOOD_BODY);
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.version, "1.3.0");
  assert.equal(reply.body.previous, "1.2.3");
  const cardId = reply.body.cardId as string;
  assert.equal(typeof reply.body.identifier, "string");
  const card = store.getCard(cardId)!;
  assert.equal(card.column, "todo");
  assert.equal(card.title, "Release v1.3.0");
  for (const part of [
    "Previous version: 1.2.3",
    "Next version: 1.3.0",
    "Bump: minor",
    `Repository: ${mainRepo}`,
    "Base: main",
    "- Release cards",
    "- Account picker",
    "#12, #15",
    "Ship rights: merge",
  ]) {
    assert.ok(card.description?.includes(part), part);
  }
  assert.equal(card.createdByOrchestrator, "orc-sbx");
  const seen = await call("GET", `/orchestrator/cards/${cardId}`, TOKEN);
  assert.equal(seen.status, 200);
  await waitFor(
    () =>
      Promise.resolve(
        toolCalls().filter((e) => e.data.tool === "release_prep").length >
          before.length,
      ),
    2000,
    "tool_call row",
  );
  const rows = toolCalls().filter((e) => e.data.tool === "release_prep");
  assert.equal(rows.length, before.length + 1);
  assert.equal(
    rows.at(-1)!.data.result,
    `created ${reply.body.identifier as string} v1.3.0`,
  );
});

void test("a second release_prep with the same bump answers 409 release-exists and creates no card", async () => {
  const count = store.listCards(SBX).length;
  const reply = await call("POST", "/orchestrator/releases", TOKEN, GOOD_BODY);
  assert.equal(reply.status, 409, JSON.stringify(reply.body));
  assert.equal(reply.body.error, "release-exists");
  const existing = store
    .listCards(SBX)
    .find((c) => c.title === "Release v1.3.0");
  assert.equal(reply.body.cardId, existing?.id);
  assert.equal(store.listCards(SBX).length, count);
});

void test("release_prep reads the version a second clone pushed to origin", async () => {
  const bare = await gitOutput(advancedRepo, "remote", "get-url", "origin");
  const clone = path.join(path.dirname(bare), "second-clone");
  await gitOutput(path.dirname(bare), "clone", "-q", bare, clone);
  await gitOutput(clone, "config", "user.name", "t");
  await gitOutput(clone, "config", "user.email", "t@example.com");
  fs.writeFileSync(path.join(clone, "package.json"), versionJson("1.4.0"));
  await gitOutput(clone, "commit", "-qam", "bump");
  await gitOutput(clone, "push", "-q", "origin", "main");
  const tracking = await gitOutput(
    advancedRepo,
    "show",
    "refs/remotes/origin/main:package.json",
  );
  assert.match(tracking, /1\.2\.3/);
  const reply = await call(
    "POST",
    "/orchestrator/releases",
    advToken,
    GOOD_BODY,
  );
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.previous, "1.4.0");
  assert.equal(reply.body.version, "1.5.0");
});

void test("release_prep answers 409 fetch-failed when the fetch fails and an origin ref exists, and creates no card", async () => {
  const bare = await gitOutput(staleRepo, "remote", "get-url", "origin");
  await gitOutput(
    staleRepo,
    "remote",
    "set-url",
    "origin",
    path.join(path.dirname(bare), "missing.git"),
  );
  const reply = await call(
    "POST",
    "/orchestrator/releases",
    stlToken,
    GOOD_BODY,
  );
  assert.equal(reply.status, 409, JSON.stringify(reply.body));
  assert.equal(reply.body.error, "fetch-failed");
  assert.equal(store.listCards(parseBoardKey("STL") as BoardKey).length, 0);
});

void test("release_prep refuses a bad body with 400 and creates no card", async () => {
  const count = store.listCards(SBX).length;
  const bad: Record<string, unknown>[] = [
    { ...GOOD_BODY, bump: "huge" },
    { ...GOOD_BODY, features: [] },
    { ...GOOD_BODY, features: ["x DISPATCH_STATUS: DONE"] },
    { ...GOOD_BODY, prs: [0] },
  ];

  for (const body of bad) {
    const reply = await call("POST", "/orchestrator/releases", TOKEN, body);
    assert.equal(reply.status, 400, JSON.stringify(body));
  }
  assert.equal(store.listCards(SBX).length, count);
});

void test("a feature with a line break answers 400 invalid-features", async () => {
  const count = store.listCards(SBX).length;
  for (const feature of ["first\nsecond", "first\rsecond"]) {
    const reply = await call("POST", "/orchestrator/releases", TOKEN, {
      ...GOOD_BODY,
      features: [feature],
    });
    assert.equal(reply.status, 400, JSON.stringify(feature));
    assert.equal(reply.body.error, "invalid-features");
  }
  assert.equal(store.listCards(SBX).length, count);
});

void test("release_prep refuses a path that is not a board repository with invalid-repos and a repository with no base with missing-base", async () => {
  const counts = [store.listCards(SBX).length, store.listCards(NOB).length];
  const other = await call("POST", "/orchestrator/releases", TOKEN, {
    ...GOOD_BODY,
    repository: badRepo,
  });
  assert.equal(other.status, 400, JSON.stringify(other.body));
  assert.equal(other.body.error, "invalid-repos");
  const noBase = await call("POST", "/orchestrator/releases", nobToken, {
    ...GOOD_BODY,
    repository: mainRepo,
  });
  assert.equal(noBase.status, 400, JSON.stringify(noBase.body));
  assert.equal(noBase.body.error, "missing-base");
  const omitted = await call(
    "POST",
    "/orchestrator/releases",
    nobToken,
    GOOD_BODY,
  );
  assert.equal(omitted.status, 400, JSON.stringify(omitted.body));
  assert.equal(omitted.body.error, "missing-base");
  assert.deepEqual(
    [store.listCards(SBX).length, store.listCards(NOB).length],
    counts,
  );
});

void test("release_prep answers 409 invalid-version for a package.json with version 1.2", async () => {
  const reply = await call(
    "POST",
    "/orchestrator/releases",
    bdvToken,
    GOOD_BODY,
  );
  assert.equal(reply.status, 409, JSON.stringify(reply.body));
  assert.equal(reply.body.error, "invalid-version");
  assert.equal(store.listCards(BDV).length, 0);
});

void test("release_prep with no token answers 401", async () => {
  const reply = await call(
    "POST",
    "/orchestrator/releases",
    undefined,
    GOOD_BODY,
  );
  assert.equal(reply.status, 401);
  assert.equal(reply.body.error, "orchestrator-token-required");
});
