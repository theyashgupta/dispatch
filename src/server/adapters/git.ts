import fsp from "node:fs/promises";
import { run } from "./exec.js";

/**
 * `git worktree prune` — clears stale registrations (e.g. a worktree dir removed by hand)
 * so a subsequent add doesn't hit a phantom "already used by worktree at" fatal. Cheap + always safe.
 */
export async function worktreePrune(repoPath: string): Promise<void> {
  await run("git", ["worktree", "prune"], { cwd: repoPath });
}

/** Discriminated outcome of the Done-cleanup preflight probe (PRE-01/PRE-04). */
export type WorktreeStatus =
  | { kind: "clean" }
  | { kind: "dirty"; count: number }
  | { kind: "orphan" }
  | { kind: "error"; stderr: string };

const ORPHAN_STDERR = ["not a git repository", "must be run in a work tree"];

/**
 * Read-only Done-cleanup preflight probe (PRE-01): `git status --porcelain --untracked-files=all`
 * counts every modified, staged, and untracked path; zero lines is `clean`, any lines is `dirty`
 * with that count, so a dirty worktree can refuse teardown before any destructive step runs. On a
 * thrown error it classifies strictly on the git stderr (PRE-04): the two verified fragments
 * `not a git repository` / `must be run in a work tree` mark an `orphan` (a stale registration or a
 * repo already gone — cleanup proceeds), and any other stderr is a non-orphan `error`. The `run`
 * chokepoint drops `.code`/`.exitCode`/`.signal`, so `.stderr` is the only classification signal.
 * The caller stats the worktree dir first, so a missing cwd never reaches this probe.
 */
export async function worktreeStatus(
  worktreePath: string,
): Promise<WorktreeStatus> {
  try {
    const { stdout } = await run(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: worktreePath },
    );
    const count = stdout.split("\n").filter((l) => l.trim() !== "").length;
    return count === 0 ? { kind: "clean" } : { kind: "dirty", count };
  } catch (err) {
    const stderr = ((err as { stderr?: string }).stderr ?? "").toLowerCase();
    if (ORPHAN_STDERR.some((fragment) => stderr.includes(fragment))) {
      return { kind: "orphan" };
    }
    return { kind: "error", stderr };
  }
}

/**
 * `git fetch origin <base>` — refresh the base ref before cutting a worktree.
 * On a missing/unreachable ref git exits non-zero (`fatal: couldn't find remote ref <base>`);
 * the caller catches and falls back to the local base with a recorded warning.
 */
export async function fetchBase(repoPath: string, base: string): Promise<void> {
  await run("git", ["fetch", "origin", base], { cwd: repoPath });
}

/**
 * True if a LOCAL branch named `branch` exists. Uses `rev-parse --verify refs/heads/<branch>`;
 * swallows the failure into `false` (never rethrows) — this is a probe, not an operation.
 */
export async function branchExists(
  repoPath: string,
  branch: string,
): Promise<boolean> {
  try {
    await run("git", ["rev-parse", "--verify", "refs/heads/" + branch], {
      cwd: repoPath,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * True if an arbitrary ref resolves (same swallow-pattern as branchExists).
 * Used for the local-base fallback check when `git fetch origin <base>` fails.
 */
export async function revParseVerify(
  repoPath: string,
  ref: string,
): Promise<boolean> {
  try {
    await run("git", ["rev-parse", "--verify", ref], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * The default branch name from `origin/HEAD` (e.g. `refs/remotes/origin/main` -> `main`), or null.
 * `origin/HEAD` is frequently unset on local clones, so a missing symref swallows into null (never
 * rethrows) — this is a probe, not an operation. The caller owns the fallback order.
 */
export async function originHeadRef(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await run(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      { cwd: repoPath },
    );
    const ref = stdout.trim();
    const name = ref.slice(ref.lastIndexOf("/") + 1);
    return name || null;
  } catch {
    return null;
  }
}

/**
 * The currently checked-out branch name — the reliable final fallback when no default branch can
 * be detected from the remote or the conventional names.
 * @remarks Tries `symbolic-ref` first: it reads `.git/HEAD`'s symbolic target without resolving to
 * a commit, so it works on an unborn HEAD (a freshly-`git init`'d repo with zero commits), where
 * `rev-parse --abbrev-ref HEAD` fatals with "ambiguous argument 'HEAD'". Falls back to
 * `rev-parse --abbrev-ref HEAD` on failure, preserving the existing detached-HEAD behavior
 * (`symbolic-ref` fails there too, and the fallback returns the literal string `"HEAD"`).
 */
export async function currentBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await run("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: repoPath,
    });
    return stdout.trim();
  } catch {
    const { stdout } = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
    });
    return stdout.trim();
  }
}

/**
 * True if `worktreePath` is ALREADY registered as a worktree of `repoPath` (restart idempotency,
 * 05-RESEARCH Probe 4: `git worktree add` on an existing path fails fatal exit 128). Parses
 * `git worktree list --porcelain`, whose per-worktree stanza opens with a literal
 * `worktree <absolute-path>` line. git records worktree paths realpath-resolved
 * (`real_pathdup`), while `worktreePath` is built by `path.join` from the CONFIGURED
 * `workspaceRoot` — which `path.join` normalizes but does NOT symlink-resolve. On macOS a
 * `/tmp`/`/var` root (→ `/private/…`) or any user symlink makes a raw string compare miss,
 * returning false, re-running `git worktree add` into the existing path, and failing fatal
 * exit 128 (the exact failure this probe exists to prevent). So realpath-resolve BOTH sides
 * before comparing (falling back to the raw path when it doesn't exist on disk). Same
 * swallow-to-boolean shape as revParseVerify: any subprocess failure returns false ("not
 * registered"), so the normal add path runs and surfaces a real error there rather than here.
 */
export async function worktreeRegistered(
  repoPath: string,
  worktreePath: string,
): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["worktree", "list", "--porcelain"], {
      cwd: repoPath,
    });
    const target = await fsp.realpath(worktreePath).catch(() => worktreePath);
    for (const line of stdout.split("\n")) {
      if (!line.startsWith("worktree ")) continue;
      const listed = line.slice("worktree ".length);
      if (
        listed === target ||
        (await fsp.realpath(listed).catch(() => listed)) === target
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Create a NEW branch and attach a worktree in one step, cut from `baseRef`:
 *   `git worktree add -b <branch> <worktreePath> <baseRef>`
 * (git also sets up tracking automatically when baseRef is `origin/<base>`).
 */
export async function worktreeAddNewBranch(
  repoPath: string,
  worktreePath: string,
  branch: string,
  baseRef: string,
): Promise<void> {
  await run("git", ["worktree", "add", "-b", branch, worktreePath, baseRef], {
    cwd: repoPath,
  });
}

/**
 * Attach a worktree onto an EXISTING branch (the locked "reuse" path):
 *   `git worktree add <worktreePath> <branch>`
 *
 * If that branch is already checked out in a live worktree, git fails (post-prune, so it's
 * genuinely live) with the fatal:  `is already used by worktree at`
 * The saga (Plan 03) string-matches that stderr fragment to pick the `branch-conflict` variant.
 */
export async function worktreeAddExistingBranch(
  repoPath: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  await run("git", ["worktree", "add", worktreePath, branch], {
    cwd: repoPath,
  });
}

/**
 * `git worktree remove --force <worktreePath>` — rollback compensation. Unregisters and
 * deletes the worktree dir; the branch SURVIVES (rollback deletes saga-created branches
 * separately via branchDelete). Never `rm -rf` a worktree dir (leaves prunable registrations).
 */
export async function worktreeRemove(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  await run("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: repoPath,
  });
}

/**
 * `git branch -D <branch>` — rollback compensation for a SAGA-CREATED branch only.
 * A reused pre-existing branch must never reach here (ctx bookkeeping enforces that in Plan 03).
 */
export async function branchDelete(
  repoPath: string,
  branch: string,
): Promise<void> {
  await run("git", ["branch", "-D", branch], { cwd: repoPath });
}
