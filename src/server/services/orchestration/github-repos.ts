import { originUrl } from "../../adapters/git.js";
import { repoOfRemote } from "../domain/ship-checks.js";
import { createTtlCache } from "../infra/ttl-cache.js";
import { listBoards } from "./boards.js";

const GITHUB_REPOS_TTL_MS = 10 * 60_000;

const CACHE_KEY = "repos";

async function boardRepositoryPaths(): Promise<string[]> {
  const { boards } = await listBoards(() => Promise.resolve(null));
  return boards
    .filter((board) => !board.archived)
    .flatMap((board) => board.repositories.map((r) => r.path));
}

/** The `owner/name` of the GitHub repository behind the `origin` of `repoPath`, or null. */
export async function githubRepoAt(
  repoPath: string,
  readOrigin: (repoPath: string) => Promise<string | null> = originUrl,
): Promise<string | null> {
  const url = await readOrigin(repoPath);
  return url === null ? null : repoOfRemote(url);
}

/**
 * Build the cached reader of the GitHub repositories behind the board repositories.
 *
 * @remarks
 * The GitHub source and the repos route share one reader, because a second reader would hold a second cache and could answer a different list.
 */
export function createGithubReposReader(
  readPaths: () => Promise<string[]> = boardRepositoryPaths,
  readOrigin: (repoPath: string) => Promise<string | null> = originUrl,
  now: () => number = Date.now,
): () => Promise<string[]> {
  const cache = createTtlCache<string[]>(GITHUB_REPOS_TTL_MS, now);
  return async () => {
    const cached = cache.get(CACHE_KEY);
    if (cached) return cached;
    const repos = new Set<string>();
    for (const repoPath of await readPaths()) {
      const repo = await githubRepoAt(repoPath, readOrigin);
      if (repo !== null) repos.add(repo);
    }
    const sorted = [...repos].sort();
    if (sorted.length > 0) cache.set(CACHE_KEY, sorted);
    return sorted;
  };
}

export const githubReposReader = createGithubReposReader();
