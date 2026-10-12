import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { run } from "./exec.js";
import { fetchPullHead, originUrl } from "./git.js";

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "g21-git-origin-"));

after(() => fs.rmSync(root, { recursive: true, force: true }));

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: IDENTITY,
  });
  return stdout.trim();
}

function makeDir(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  return dir;
}

test("originUrl reads a real origin and answers null without one", async () => {
  const dir = makeDir("origin-read");
  await git(dir, "init", "-q");
  assert.equal(await originUrl(dir), null);
  await git(dir, "remote", "add", "origin", "https://github.com/a/b.git");
  assert.equal(await originUrl(dir), "https://github.com/a/b.git");
  await git(
    dir,
    "config",
    "url./srv/mirror/b.git.insteadOf",
    "https://github.com/a/b.git",
  );
  assert.equal(await originUrl(dir), "https://github.com/a/b.git");
  assert.equal(await originUrl(path.join(dir, "missing")), null);
});

test("fetchPullHead refuses a number that is not a positive integer", async () => {
  const repo = makeDir("guard");
  await git(repo, "init", "-q");
  for (const value of [0, -3, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      fetchPullHead(repo, value),
      /Invalid pull request number/,
      String(value),
    );
  }
});

test("fetchPullHead fetches the pull head into review/pr-<n> and moves it on a force push", async () => {
  const bare = makeDir("origin.git");
  const author = makeDir("author");
  const clone = makeDir("clone");
  await git(bare, "init", "-q", "--bare", "-b", "main");
  await git(author, "init", "-q", "-b", "main");
  await git(author, "remote", "add", "origin", bare);
  fs.writeFileSync(path.join(author, "a.txt"), "a");
  await git(author, "add", "-A");
  await git(author, "commit", "-q", "-m", "base");
  await git(author, "push", "-q", "origin", "main");
  await git(author, "checkout", "-q", "-b", "side");
  fs.writeFileSync(path.join(author, "pr.txt"), "pr");
  await git(author, "add", "-A");
  await git(author, "commit", "-q", "-m", "pr");
  const first = await git(author, "rev-parse", "HEAD");
  await git(author, "push", "-q", "origin", "side:refs/pull/9/head");
  await git(clone, "init", "-q", "-b", "main");
  await git(clone, "remote", "add", "origin", bare);

  await fetchPullHead(clone, 9);
  assert.equal(await git(clone, "rev-parse", "review/pr-9"), first);

  await git(author, "commit", "-q", "--amend", "-m", "pr reworded");
  const second = await git(author, "rev-parse", "HEAD");
  await git(author, "push", "-q", "-f", "origin", "side:refs/pull/9/head");
  await fetchPullHead(clone, 9);
  assert.equal(await git(clone, "rev-parse", "review/pr-9"), second);
});
