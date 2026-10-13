import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Item } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { gitOutput } from "../test-support/git-fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { githubRouter } = await import("./github.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
await store.load();

const ghPath = path.join(env.binDir, "gh");
const GH_TOKEN = ["g5", "fake", "gh", "token"].join("-");
function connectGithub(loggedIn: boolean): void {
  fs.writeFileSync(
    ghPath,
    loggedIn
      ? `#!/bin/sh\n[ "$1 $2" = "auth token" ] && echo ${GH_TOKEN} && exit 0\nexit 1\n`
      : "#!/bin/sh\nexit 1\n",
    { mode: 0o755 },
  );
}
connectGithub(true);
setOrchestrationConfig({
  linearApiKey: "",
  sources: { linear: { apiKey: "" }, github: { enabled: true } },
});

const app = express();
app.use("/api", express.json(), githubRouter, httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

const repoPath = path.join(env.root, "repos", "widgets");
fs.mkdirSync(repoPath, { recursive: true });
await gitOutput(repoPath, "init", "-q");
await gitOutput(
  repoPath,
  "remote",
  "add",
  "origin",
  "git@github.com:acme/widgets.git",
);
await store.addWorkspaceFolder(DEFAULT_BOARD_KEY, repoPath);

const ACME = parseBoardKey("ACME")!;
await store.createBoard({
  key: ACME,
  name: "Acme",
  workspaceRoot: null,
  repositories: [{ path: repoPath, baseBranch: null, checkCommand: "" }],
  linearTeamKeys: [],
});

const archivedRepoPath = path.join(env.root, "repos", "gadgets");
fs.mkdirSync(archivedRepoPath, { recursive: true });
await gitOutput(archivedRepoPath, "init", "-q");
await gitOutput(
  archivedRepoPath,
  "remote",
  "add",
  "origin",
  "git@github.com:acme/gadgets.git",
);
const OLD = parseBoardKey("OLD")!;
await store.createBoard({
  key: OLD,
  name: "Old",
  workspaceRoot: null,
  repositories: [
    { path: archivedRepoPath, baseBranch: null, checkCommand: "" },
  ],
  linearTeamKeys: [],
});
await store.setBoardArchived(OLD, true);

function openPr(repo: string, number: number): Item {
  return {
    id: `github:${repo}#${number}`,
    source: "github",
    type: "pr_open",
    title: `Fix ${number}`,
    snippet: "body",
    url: `https://github.com/${repo}/pull/${number}`,
    createdAt: "2026-10-01T00:00:00.000Z",
    priority: 25,
    state: "unread",
    meta: {
      repo,
      number: String(number),
      headRef: "fix/race",
      baseRef: "develop",
    },
  };
}
await store.upsertItems(
  "github",
  [
    openPr("acme/widgets", 1),
    openPr("acme/elsewhere", 2),
    openPr("acme/widgets", 3),
    openPr("acme/widgets", 4),
    openPr("acme/widgets", 5),
  ],
  { kind: "snapshot" },
);

async function post(route: string, body?: unknown) {
  const res = await fetch(`${base}/github/pr/${route}/review`, {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      cardId?: string;
      created?: boolean;
      column?: string;
      boardKey?: string;
      error?: string;
    },
  };
}

test("the first call makes a local card with the PR link, the PR fields and the workspace", async () => {
  const { status, body } = await post("acme/widgets/1");
  assert.equal(status, 201);
  assert.equal(body.created, true);
  assert.equal(body.column, "inbox");
  assert.equal(body.boardKey, DEFAULT_BOARD_KEY);
  const card = store.getCard(body.cardId!)!;
  assert.equal(card.source, "local");
  assert.equal(card.url, "https://github.com/acme/widgets/pull/1");
  assert.deepEqual(card.reviewPr, {
    repo: "acme/widgets",
    number: 1,
    url: "https://github.com/acme/widgets/pull/1",
    head: "fix/race",
    base: "develop",
    repoPath,
  });
  assert.deepEqual(card.workspace, {
    folder: path.dirname(repoPath),
    repos: [{ path: repoPath, base: "develop" }],
  });
});

test("the second call answers the same card with created false", async () => {
  const first = await post("acme/widgets/1");
  const second = await post("acme/widgets/1");
  assert.equal(second.status, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.cardId, first.body.cardId);
  assert.equal(second.body.column, store.getCard(first.body.cardId!)?.column);
});

test("an unknown pull request is 404 and makes no card", async () => {
  const before = store.snapshot(DEFAULT_BOARD_KEY).cards.length;
  const { status } = await post("acme/widgets/99");
  assert.equal(status, 404);
  assert.equal(store.snapshot(DEFAULT_BOARD_KEY).cards.length, before);
});

test("a pull request of a repository no board holds is 409 no-workspace and makes no card", async () => {
  const before = store.snapshot(DEFAULT_BOARD_KEY).cards.length;
  const res = await fetch(`${base}/github/pr/acme/elsewhere/2/review`, {
    method: "POST",
  });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, "no-workspace");
  assert.equal(store.snapshot(DEFAULT_BOARD_KEY).cards.length, before);
  assert.equal(store.getItem("github:acme/elsewhere#2")?.cardId, undefined);
});

test("a body board that holds the repository is preferred over the first open board", async () => {
  const { status, body } = await post("acme/widgets/3", { board: ACME });
  assert.equal(status, 201);
  assert.equal(body.boardKey, ACME);
  assert.equal(store.getCard(body.cardId!)?.boardKey, ACME);
});

test("a body board that does not hold the repository falls back to the first open board", async () => {
  const { status, body } = await post("acme/widgets/4", { board: "NOPE" });
  assert.equal(status, 201);
  assert.equal(body.boardKey, DEFAULT_BOARD_KEY);
});

test("a repeat Review with another board answers the board the card is on", async () => {
  const first = await post("acme/widgets/5", { board: ACME });
  assert.equal(first.body.boardKey, ACME);
  const second = await post("acme/widgets/5", { board: DEFAULT_BOARD_KEY });
  assert.equal(second.status, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.cardId, first.body.cardId);
  assert.equal(second.body.boardKey, ACME);
});

test("a body with an event field answers 400 and makes no card", async () => {
  const before = store.snapshot(DEFAULT_BOARD_KEY).cards.length;
  const { status } = await post("acme/widgets/1", { event: "APPROVE" });
  assert.equal(status, 400);
  assert.equal(store.snapshot(DEFAULT_BOARD_KEY).cards.length, before);
});

test("no credential answers 401 for a known pull request and 404 for an unknown one", async () => {
  connectGithub(false);
  try {
    const known = await post("acme/widgets/1");
    assert.equal(known.status, 401);
    assert.equal(known.body.error, "no-credential");
    assert.equal((await post("nope/nope/1")).status, 404);
  } finally {
    connectGithub(true);
  }
});

test("a bad number is rejected before any lookup", async () => {
  const { status } = await post("acme/widgets/abc");
  assert.equal(status, 400);
});

test("the repos route answers the GitHub repositories of the board repositories", async () => {
  const res = await fetch(`${base}/github/repos`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { repos: ["acme/widgets"] });
});

test("the repos route leaves out the repositories of archived boards", async () => {
  const res = await fetch(`${base}/github/repos`);
  assert.ok(
    !((await res.json()) as { repos: string[] }).repos.includes("acme/gadgets"),
  );
});
