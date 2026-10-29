import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { git, makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf } from "./harness/board-reads.js";
import {
  MINUTE,
  makeNote,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const NAME = "local-209-worktree-node-modules";
const BOARD = "WNM";
const CARD = "WNM-1";

const note = makeNote(NAME);

/**
 * Commit a package with one local `file:` dependency and its lock file to the sample repo.
 *
 * @remarks `npm ci` with no dependency at all creates no `node_modules`, so the local dependency
 * is the smallest lock that proves the install ran, and it needs no network.
 */
function addPackage(repo: string, home: string): void {
  fs.mkdirSync(path.join(repo, "local-dep"));
  fs.writeFileSync(
    path.join(repo, "local-dep", "package.json"),
    JSON.stringify({ name: "local-dep", version: "1.0.0" }),
  );
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({
      name: "sample-app",
      version: "1.0.0",
      private: true,
      dependencies: { "local-dep": "file:local-dep" },
    }),
  );
  fs.writeFileSync(
    path.join(repo, "package-lock.json"),
    JSON.stringify({
      name: "sample-app",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "sample-app",
          version: "1.0.0",
          dependencies: { "local-dep": "file:local-dep" },
        },
        "local-dep": { version: "1.0.0" },
        "node_modules/local-dep": { resolved: "local-dep", link: true },
      },
    }),
  );
  git(repo, home, ["add", "-A"]);
  git(repo, home, ["commit", "-q", "-m", "chore: add package"]);
  git(repo, home, ["push", "-q", "origin", "main"]);
}

async function runScenario(sb: Sandbox): Promise<void> {
  const sample = makeSampleRepo(sb.root, sb.home);
  addPackage(sample.repo, sb.home);
  assert.equal(fs.existsSync(path.join(sample.repo, "node_modules")), false);
  fs.writeFileSync(
    path.join(sb.scenarios, "default.json"),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  const sessions = path.join(sb.workspaces, "wnm-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Node modules board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    { title: "Install on start", description: "A worktree with a lock file." },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, CARD);
  const start = await sb.api("POST", `/api/cards/${CARD}/start`, {
    folder: sb.workspaces,
    repos: [{ path: sample.repo, base: "main" }],
  });
  assert.equal(start.status, 202);
  const live = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, CARD);
      return card?.tmuxSession !== undefined && card.workspacePath
        ? card
        : null;
    },
    MINUTE,
    "the card with a live tmux session",
  );
  const worktree = path.join(live.workspacePath ?? "", sample.name);
  note(`session started in ${worktree}`);
  assert.equal(
    fs.existsSync(
      path.join(worktree, "node_modules", "local-dep", "package.json"),
    ),
    true,
    "npm ci installed node_modules before the session launched",
  );
}

void test(
  "scenario-LOCAL-209-worktree-node-modules: a new worktree gets node_modules from npm ci before claude starts",
  { timeout: 5 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: NAME });
    try {
      await runScenario(sb);
    } finally {
      await sb.stop();
    }
  },
);
