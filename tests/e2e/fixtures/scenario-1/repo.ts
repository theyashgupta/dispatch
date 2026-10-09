import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SHIP_IDENTITY } from "../../harness/sandbox.js";

export interface SampleRepo {
  repo: string;
  bare: string;
  name: string;
}

export function git(cwd: string, home: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: SHIP_IDENTITY.name,
      GIT_AUTHOR_EMAIL: SHIP_IDENTITY.email,
      GIT_COMMITTER_NAME: SHIP_IDENTITY.name,
      GIT_COMMITTER_EMAIL: SHIP_IDENTITY.email,
    },
  }).trim();
}

/**
 * Make a local repository with one commit on `main` and a bare `origin` it pushed to.
 *
 * @remarks The repository ignores the loop folders, so the worktree of a group stays clean while
 * the replay writes its loop files there, which the ship flow requires.
 */
export function makeSampleRepo(root: string, home: string): SampleRepo {
  const name = "sample-app";
  const repo = path.join(root, name);
  const bare = path.join(root, "origin.git");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, home, ["init", "-q", "-b", "main"]);
  git(repo, home, ["config", "user.name", SHIP_IDENTITY.name]);
  git(repo, home, ["config", "user.email", SHIP_IDENTITY.email]);
  git(repo, home, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(repo, "README.md"), "# Sample app\n");
  fs.writeFileSync(
    path.join(repo, ".gitignore"),
    ".planning/\n.claude/\n.roadmap/\n.dispatch-input/\n",
  );
  git(repo, home, ["add", "-A"]);
  git(repo, home, ["commit", "-q", "-m", "chore: initial commit"]);
  fs.mkdirSync(bare);
  git(bare, home, ["init", "-q", "--bare", "-b", "main"]);
  git(repo, home, ["remote", "add", "origin", bare]);
  git(repo, home, ["push", "-q", "origin", "main"]);
  return { repo, bare, name };
}

/** Add a branch off `main` that holds one new file, without checking it out in the main checkout. */
export function addUnitBranch(
  sample: SampleRepo,
  home: string,
  branch: string,
  file: string,
): void {
  const scratch = path.join(path.dirname(sample.repo), `scratch-${Date.now()}`);
  git(sample.repo, home, [
    "worktree",
    "add",
    "-q",
    "-b",
    branch,
    scratch,
    "main",
  ]);
  fs.writeFileSync(path.join(scratch, file), `${branch}\n`);
  git(scratch, home, ["add", "-A"]);
  git(scratch, home, ["commit", "-q", "-m", `${branch} work`]);
  git(sample.repo, home, ["worktree", "remove", "--force", scratch]);
}

/** The subjects of the commits on the bare origin `main`, newest first. */
export function mainSubjects(sample: SampleRepo, home: string): string[] {
  return git(sample.bare, home, ["log", "--format=%s", "main"]).split("\n");
}
