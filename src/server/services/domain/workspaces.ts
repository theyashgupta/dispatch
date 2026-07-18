import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import type { Dirent } from "node:fs";
import type {
  DirEntry,
  DirListing,
  DiscoveredRepo,
} from "../../../shared/types.js";
import {
  originHeadRef,
  branchExists,
  currentBranch,
} from "../../adapters/git.js";

/**
 * Normalize a user-supplied folder path to a canonical absolute form BEFORE any validate/persist/
 * remove, so the registry never stores two spellings of the same folder and traversal tricks can't
 * survive the round-trip. Expands a leading `~` (the shell would, but this input never hits a shell),
 * resolves to absolute, and drops a trailing slash so `/foo` and `/foo/` collapse to one key.
 */
export function expandPath(input: string): string {
  const trimmed = input.trim();
  const expanded =
    trimmed === "~" || trimmed.startsWith("~/")
      ? path.join(os.homedir(), trimmed.slice(1))
      : trimmed;
  const resolved = path.resolve(expanded);
  return resolved.length > 1 ? resolved.replace(/\/$/, "") : resolved;
}

/**
 * Classify a folder without leaking its path: "missing" when it does not exist, "not-a-folder" when
 * it exists but is a file, "ok" otherwise. Any stat error collapses to "missing" so the caller maps a
 * fixed, value-free string rather than surfacing an errno.
 */
export async function validateFolder(
  absPath: string,
): Promise<"ok" | "missing" | "not-a-folder"> {
  try {
    const stat = await fsp.stat(absPath);
    return stat.isDirectory() ? "ok" : "not-a-folder";
  } catch {
    return "missing";
  }
}

/**
 * True when `dir` carries a `.git` entry (a repo root has a `.git` dir; a worktree/submodule has a
 * `.git` file) — the fs signal discovery and re-stat both key off, swallowed to false on any error.
 */
async function hasGitEntry(dir: string): Promise<boolean> {
  return fsp.stat(path.join(dir, ".git")).then(
    () => true,
    () => false,
  );
}

/**
 * Discover git repos under a registered folder with a DEPTH-1 fs sweep only — never git, never
 * recursion. Discovery must stay cheap and predictable (a deep git crawl of an arbitrary folder is
 * the anti-pattern), so a repo is either the folder itself or one of its immediate child directories.
 * Base detection (the only git touch) runs per discovered repo. A registered-but-deleted folder
 * yields `[]` rather than throwing, so the modal shows an empty list instead of an error.
 */
export async function discoverRepos(
  absPath: string,
): Promise<DiscoveredRepo[]> {
  const repoPaths: string[] = [];
  if (await hasGitEntry(absPath)) repoPaths.push(absPath);

  let children: Dirent[];
  try {
    children = await fsp.readdir(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const child of children) {
    if (!child.isDirectory()) continue;
    const childPath = path.join(absPath, child.name);
    if (await hasGitEntry(childPath)) repoPaths.push(childPath);
  }

  const repos: DiscoveredRepo[] = [];
  for (const repoPath of repoPaths) {
    repos.push({
      path: repoPath,
      name: path.basename(repoPath),
      base: await detectBase(repoPath),
    });
  }
  return repos;
}

/**
 * Resolve the base branch to cut a worktree from, in the locked fallback order: the remote default
 * (`origin/HEAD`, frequently unset locally) → a local `main` → a local `master` → the currently
 * checked-out branch. This orchestration lives in the service; the adapter exposes only the probes.
 */
export async function detectBase(repoPath: string): Promise<string> {
  const origin = await originHeadRef(repoPath);
  if (origin) return origin;
  if (await branchExists(repoPath, "main")) return "main";
  if (await branchExists(repoPath, "master")) return "master";
  return currentBranch(repoPath);
}

/**
 * Re-stat a start payload's repos just before the saga: true only when every path still exists AND
 * still carries a `.git` entry. Returns a bare boolean (no path) so the start route can answer with
 * fixed, value-free copy when a selected repo vanished between discovery and start.
 */
export async function restatRepos(
  repos: { path: string; base: string }[],
): Promise<boolean> {
  for (const repo of repos) {
    if (!(await hasGitEntry(repo.path))) return false;
  }
  return true;
}

/**
 * True when `absPath` resolves inside the user's home directory subtree. Resolves symlinks on BOTH
 * sides (mirrors git.ts's worktreeRegistered realpath-both-sides comparison) before comparing, so a
 * symlink inside `~` pointing outside it can never pass. Case-folds both sides with `.toLowerCase()`:
 * empirically verified this session that `fsp.realpath` does NOT normalize casing on this machine's
 * default case-insensitive APFS volume, so a bare case-sensitive compare would spuriously reject a
 * legitimate in-home path whose casing drifted from the on-disk original.
 */
export async function isWithinHome(absPath: string): Promise<boolean> {
  const home = os.homedir();
  const [realTarget, realHome] = await Promise.all([
    fsp.realpath(absPath).catch(() => absPath),
    fsp.realpath(home).catch(() => home),
  ]);
  const targetFold = realTarget.toLowerCase();
  const homeFold = realHome.toLowerCase();
  return targetFold === homeFold || targetFold.startsWith(homeFold + path.sep);
}

/**
 * Cap on concurrent `.git` stats per batch in `browseDirectory`. Bounds the fan-out so a directory
 * with thousands of children can't exhaust file descriptors — under EMFILE, `hasGitEntry` swallows
 * the error to `false`, which would otherwise silently mislabel real repos as plain folders.
 */
const DIR_STAT_BATCH_SIZE = 32;

/**
 * List the immediate child directories of `rawPath` (default `~`) for the folder-browser picker.
 * Rejects any resolved target outside the home subtree (symlinks resolved first, defense-in-depth —
 * the UI never constructs an out-of-bound request) rather than silently clamping to home. The
 * returned `path`/`parent`/entry paths are all the CANONICAL (realpath'd) form, so every path the
 * client echoes back into a later request stays canonical and in-bound. EACCES/ENOENT on the target
 * itself yields `{ readable: false, entries: [] }` (still `ok: true`) rather than throwing, matching
 * discoverRepos' registered-but-deleted-folder tolerance. Symlinked directories are deliberately
 * excluded from `entries` (isDirectory() is false for a symlink Dirent) so every listed entry is
 * itself a real, already-in-bound path — no separate per-entry bound check is needed.
 */
export async function browseDirectory(
  rawPath: string | undefined,
): Promise<{ ok: true; listing: DirListing } | { ok: false }> {
  const target =
    rawPath !== undefined && rawPath.trim() !== ""
      ? expandPath(rawPath)
      : os.homedir();

  const [canonicalPath, canonicalHome] = await Promise.all([
    fsp.realpath(target).catch(() => target),
    fsp.realpath(os.homedir()).catch(() => os.homedir()),
  ]);

  if (!(await isWithinHome(canonicalPath))) {
    return { ok: false };
  }

  const foldedPath = canonicalPath.toLowerCase();
  const foldedHome = canonicalHome.toLowerCase();
  const parent = foldedPath === foldedHome ? null : path.dirname(canonicalPath);

  let children: Dirent[];
  try {
    children = await fsp.readdir(canonicalPath, { withFileTypes: true });
  } catch {
    return {
      ok: true,
      listing: { path: canonicalPath, parent, entries: [], readable: false },
    };
  }

  const dirs = children.filter((d) => d.isDirectory());
  const entries: DirEntry[] = [];
  for (let i = 0; i < dirs.length; i += DIR_STAT_BATCH_SIZE) {
    const batch = dirs.slice(i, i + DIR_STAT_BATCH_SIZE);
    const batchEntries = await Promise.all(
      batch.map(async (d) => ({
        name: d.name,
        path: path.join(canonicalPath, d.name),
        hasGit: await hasGitEntry(path.join(canonicalPath, d.name)),
        hidden: d.name.startsWith("."),
      })),
    );
    entries.push(...batchEntries);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    listing: { path: canonicalPath, parent, entries, readable: true },
  };
}
