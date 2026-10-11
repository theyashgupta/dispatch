import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const identity = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const savedIdentity = Object.fromEntries(
  Object.keys(identity).map((name) => [name, process.env[name]]),
);
Object.assign(process.env, identity);

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const { run } = await import("../../adapters/exec.js");
const { BoardConflictError, BoardNotFoundError, BoardValidationError } =
  await import("../domain/errors.js");
const { archiveBoard, createBoard, getBoard } = await import("./boards.js");
const { initBoardRepository } = await import("./board-repository-init.js");

const sessions = path.join(env.root, "sessions");
fs.mkdirSync(sessions, { recursive: true });
setOrchestrationConfig({ linearApiKey: "", workspaceRoot: sessions });
await store.load();
after(() => {
  for (const [name, value] of Object.entries(savedIdentity)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  env.cleanup();
});

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

async function newBoard(name: string): Promise<{ key: BoardKey; dir: string }> {
  const board = await createBoard({
    name,
    repositories: [],
    linearTeamKeys: [],
  });
  return { key: board.key, dir: board.workspaceRoot ?? "" };
}

async function git(dir: string, ...args: string[]): Promise<string> {
  return (await run("git", args, { cwd: dir })).stdout.trim();
}

test("init makes a repository below the board folder with one commit on main and lists it", async () => {
  const { key: board, dir } = await newBoard("Ledger");
  const target = path.join(dir, board.toLowerCase());
  const updated = await initBoardRepository(board);
  assert.deepEqual(updated.repositories, [
    { path: target, baseBranch: "main", checkCommand: "npm run check" },
  ]);
  assert.ok(fs.existsSync(path.join(target, ".git")));
  assert.equal(await git(target, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(await git(target, "rev-list", "--count", "HEAD"), "1");
  assert.equal(await git(target, "remote"), "");
});

test("a second init reuses the repository, with no new commit and no second entry", async () => {
  const { key: board, dir } = await newBoard("Reuse");
  const target = path.join(dir, board.toLowerCase());
  await initBoardRepository(board);
  const head = await git(target, "rev-parse", "HEAD");
  const again = await initBoardRepository(board);
  assert.equal(again.repositories.length, 1);
  assert.equal(await git(target, "rev-parse", "HEAD"), head);
  assert.equal(await git(target, "rev-list", "--count", "HEAD"), "1");
});

test("a subfolder that already holds a repository is added as it is", async () => {
  const { key: board, dir } = await newBoard("Existing");
  const target = path.join(dir, board.toLowerCase());
  fs.mkdirSync(target, { recursive: true });
  await git(target, "init", "-q", "-b", "dev");
  await git(target, "commit", "-q", "--allow-empty", "-m", "first");
  const head = await git(target, "rev-parse", "HEAD");
  const updated = await initBoardRepository(board);
  assert.deepEqual(
    updated.repositories.map((repo) => repo.path),
    [target],
  );
  assert.equal(await git(target, "rev-parse", "HEAD"), head);
  assert.equal(await git(target, "rev-parse", "--abbrev-ref", "HEAD"), "dev");
});

test("a commitless existing repository gets its empty commit and is added on its current branch", async () => {
  const { key: board, dir } = await newBoard("Bare");
  const target = path.join(dir, board.toLowerCase());
  fs.mkdirSync(target, { recursive: true });
  await git(target, "init", "-q", "-b", "dev");
  const updated = await initBoardRepository(board);
  assert.deepEqual(updated.repositories, [
    { path: target, baseBranch: "dev", checkCommand: "npm run check" },
  ]);
  assert.equal(await git(target, "rev-list", "--count", "HEAD"), "1");
  assert.equal(await git(target, "rev-parse", "--abbrev-ref", "HEAD"), "dev");
});

test("an archived board is refused and gets no folder", async () => {
  const { key: board, dir } = await newBoard("Archived");
  await archiveBoard(board);
  await assert.rejects(
    initBoardRepository(board),
    (err) => err instanceof BoardConflictError && err.code === "board-archived",
  );
  assert.equal(fs.existsSync(path.join(dir, board.toLowerCase())), false);
});

test("an unknown board answers the typed 404", async () => {
  await assert.rejects(
    initBoardRepository(key("NOPE")),
    (err) => err instanceof BoardNotFoundError && err.code === "unknown-board",
  );
});

test("a git failure answers git-init-failed and leaves the board unchanged", async () => {
  const { key: board, dir } = await newBoard("Broken");
  fs.writeFileSync(path.join(dir, board.toLowerCase()), "a file");
  const before = JSON.stringify(getBoard(board));
  await assert.rejects(
    initBoardRepository(board),
    (err) =>
      err instanceof BoardValidationError &&
      err.code === "Dispatch could not make the repository." &&
      err.details?.code === "git-init-failed",
  );
  assert.equal(JSON.stringify(getBoard(board)), before);
});

test("a detached HEAD is stored as no base branch", async () => {
  const { key: board, dir } = await newBoard("Detached");
  const target = path.join(dir, board.toLowerCase());
  fs.mkdirSync(target, { recursive: true });
  await git(target, "init", "-q", "-b", "dev");
  await git(target, "commit", "-q", "--allow-empty", "-m", "first");
  await git(target, "checkout", "-q", "--detach");
  const updated = await initBoardRepository(board);
  assert.deepEqual(updated.repositories, [
    { path: target, baseBranch: null, checkCommand: "npm run check" },
  ]);
});

test("a repository that is missing on disk does not block adding the new one", async () => {
  const stale = path.join(env.root, "repos", "stale");
  fs.mkdirSync(path.join(stale, ".git"), { recursive: true });
  const created = await createBoard({
    name: "Stale",
    repositories: [{ path: stale, baseBranch: null, checkCommand: "x" }],
    linearTeamKeys: [],
  });
  fs.rmSync(stale, { recursive: true });
  const target = path.join(created.workspaceRoot ?? "", "stale");
  const updated = await initBoardRepository(created.key);
  assert.deepEqual(
    updated.repositories.map((repo) => repo.path),
    [stale, target],
  );
});
