import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Card } from "../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { run } from "../../adapters/exec.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { steps, StartStepError } = await import("./steps.js");
const { worktreePath } = await import("../domain/workspace-paths.js");
type SagaContext = Parameters<(typeof steps)[number]["run"]>[0];

after(() => env.cleanup());

const createWorktrees = steps[1];

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args],
    { cwd, env: IDENTITY },
  );
  return stdout.trim();
}

async function commitFile(repo: string, name: string): Promise<string> {
  fs.writeFileSync(path.join(repo, name), name);
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", name);
  return await git(repo, "rev-parse", "HEAD");
}

interface Fixture {
  repo: string;
  bare: string;
  prHead: string;
  workspacePath: string;
}

let counter = 0;

/**
 * A repository on main with a bare origin whose `refs/pull/1/head` holds one extra commit.
 *
 * @remarks Origin is rewritten to a GitHub URL after the push so the saga can match the repository
 * by remote name, while `insteadOf` keeps the fetch on the local bare repository.
 */
async function makeFixture(slug = "widgets"): Promise<Fixture> {
  const dir = path.join(env.root, `fx-${counter++}`);
  const repo = path.join(dir, slug);
  const bare = path.join(dir, "origin.git");
  const workspacePath = path.join(dir, "ws");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(bare);
  fs.mkdirSync(workspacePath);
  await git(bare, "init", "-q", "--bare", "-b", "main");
  await git(repo, "init", "-q", "-b", "main");
  await commitFile(repo, "base.txt");
  await git(repo, "remote", "add", "origin", bare);
  await git(repo, "push", "-q", "origin", "main");
  await git(repo, "checkout", "-q", "-b", "side");
  const prHead = await commitFile(repo, "pr.txt");
  await git(repo, "push", "-q", "origin", "side:refs/pull/1/head");
  await git(repo, "checkout", "-q", "main");
  await git(repo, "branch", "-q", "-D", "side");
  const remote = `https://github.com/acme/${slug}.git`;
  await git(repo, "remote", "set-url", "origin", remote);
  await git(repo, "config", `url.${bare}.insteadOf`, remote);
  return { repo, bare, prHead, workspacePath };
}

function ctxFor(
  fx: Fixture,
  reviewNumber: number | null,
  opts: { others?: Fixture[]; prRepo?: string } = {},
): SagaContext {
  const card = {
    id: "LOCAL-1",
    boardKey: DEFAULT_BOARD_KEY,
    identifier: "LOCAL-1",
    workspace: {
      folder: path.dirname(fx.repo),
      repos: [fx, ...(opts.others ?? [])].map((f) => ({
        path: f.repo,
        base: "main",
      })),
    },
    ...(reviewNumber === null
      ? {}
      : {
          reviewPr: {
            repo: opts.prRepo ?? "acme/widgets",
            number: reviewNumber,
            url: "https://github.com/acme/widgets/pull/1",
            head: "side",
            base: "main",
          },
        }),
  } as Card;
  return {
    card,
    identifier: "LOCAL-1",
    sessionName: "LOCAL-1",
    sessionId: undefined,
    workspacePath: fx.workspacePath,
    extraDirection: "",
    config: { linearApiKey: "" },
    createdWorkspaceDir: false,
    createdWorktrees: [],
    createdBranches: [],
    tmuxSessionCreated: false,
    restarted: false,
    warnings: [],
  };
}

const originRefs = (bare: string) => git(bare, "for-each-ref");

test("a review card's worktree is on review/pr-1 at the pull ref commit and origin is unchanged", async () => {
  const fx = await makeFixture();
  const refsBefore = await originRefs(fx.bare);
  await createWorktrees.run(ctxFor(fx, 1));

  const wt = worktreePath(fx.workspacePath, fx.repo);
  assert.equal(
    await git(wt, "rev-parse", "--abbrev-ref", "HEAD"),
    "review/pr-1",
  );
  assert.equal(await git(wt, "rev-parse", "HEAD"), fx.prHead);
  assert.equal(await git(fx.repo, "branch", "--list", "LOCAL-1"), "");
  assert.equal(await originRefs(fx.bare), refsBefore);
});

test("a card without reviewPr never fetches a pull ref", async () => {
  const fx = await makeFixture();
  await createWorktrees.run(ctxFor(fx, null));

  const wt = worktreePath(fx.workspacePath, fx.repo);
  assert.equal(await git(wt, "rev-parse", "--abbrev-ref", "HEAD"), "LOCAL-1");
  assert.equal(await git(fx.repo, "branch", "--list", "review/*"), "");
});

test("a reused worktree does not fetch the pull ref again", async () => {
  const fx = await makeFixture();
  await createWorktrees.run(ctxFor(fx, 1));

  await git(fx.repo, "checkout", "-q", "-b", "side2", fx.prHead);
  const moved = await commitFile(fx.repo, "later.txt");
  await git(fx.repo, "push", "-q", "-f", "origin", "side2:refs/pull/1/head");
  await git(fx.repo, "checkout", "-q", "main");

  const again = ctxFor(fx, 1);
  await createWorktrees.run(again);
  assert.equal(again.createdWorktrees.length, 0);
  assert.equal(await git(fx.repo, "rev-parse", "review/pr-1"), fx.prHead);
  assert.notEqual(moved, fx.prHead);
});

test("a missing pull ref fails the step with the git error", async () => {
  const fx = await makeFixture();
  await assert.rejects(
    createWorktrees.run(ctxFor(fx, 9)),
    (err: unknown) =>
      err instanceof StartStepError &&
      err.step === "creating worktrees" &&
      err.variant === "generic",
  );
});

test("a review card fetches the pull ref into the repository named by reviewPr.repo only", async () => {
  const api = await makeFixture("api");
  const web = await makeFixture("web");
  const ctx = ctxFor(api, 1, { others: [web], prRepo: "Acme/Web" });
  await createWorktrees.run(ctx);

  assert.equal(await git(web.repo, "rev-parse", "review/pr-1"), web.prHead);
  assert.equal(await git(api.repo, "branch", "--list", "review/*"), "");
  assert.equal(ctx.createdWorktrees.length, 2);
  assert.equal(
    await git(
      worktreePath(ctx.workspacePath, api.repo),
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ),
    "LOCAL-1",
  );
  assert.equal(
    await git(
      worktreePath(ctx.workspacePath, web.repo),
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ),
    "review/pr-1",
  );
});

test("a workspace with no repository matching reviewPr.repo fails before any worktree is created", async () => {
  const api = await makeFixture("api");
  const web = await makeFixture("web");
  const ctx = ctxFor(api, 1, { others: [web], prRepo: "acme/other" });
  await assert.rejects(
    createWorktrees.run(ctx),
    (err: unknown) =>
      err instanceof StartStepError &&
      err.step === "creating worktrees" &&
      err.variant === "generic" &&
      err.message.includes("acme/other"),
  );
  assert.equal(ctx.createdWorktrees.length, 0);
  assert.equal(fs.existsSync(worktreePath(ctx.workspacePath, api.repo)), false);
  assert.equal(fs.existsSync(worktreePath(ctx.workspacePath, web.repo)), false);
});

test("a non-positive or fractional review number fails the step", async () => {
  const fx = await makeFixture();
  for (const n of [0, -1, 1.5]) {
    await assert.rejects(
      createWorktrees.run(ctxFor(fx, n)),
      (err: unknown) =>
        err instanceof StartStepError && err.step === "creating worktrees",
    );
  }
});
