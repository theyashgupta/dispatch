import type {
  DiscoveredRepo,
  WorkspacesInventory,
} from "../../../shared/types.js";
import { diskUsageKb } from "../../adapters/disk-usage.js";
import { lastCommitAt } from "../../adapters/git.js";
import { store } from "../../store/board.store.js";
import { createTtlCache, type TtlCache } from "../infra/ttl-cache.js";
import { buildWorktreeRows } from "../domain/workspace-inventory.js";
import { discoverRepos } from "../domain/workspaces.js";
import { worktreePath } from "../domain/workspace-paths.js";

const SIZE_TTL_MS = 5 * 60_000;
const COMMIT_TTL_MS = 60_000;
const DISCOVER_TTL_MS = 60_000;
const MAX_IN_FLIGHT = 4;

export interface InventoryProbes {
  diskUsageKb: (dirPath: string) => Promise<number | null>;
  lastCommitAt: (worktreePath: string) => Promise<number | null>;
  discoverRepos: (folder: string) => Promise<DiscoveredRepo[]>;
}

const REAL_PROBES: InventoryProbes = {
  diskUsageKb,
  lastCommitAt,
  discoverRepos,
};

const sizes = createTtlCache<number | null>(SIZE_TTL_MS);
const commits = createTtlCache<number | null>(COMMIT_TTL_MS);
const discoveries = createTtlCache<DiscoveredRepo[]>(DISCOVER_TTL_MS);

/**
 * Runs queued tasks with at most `max` in flight.
 *
 * @remarks Bounds concurrent `du` and `git` children so a board with many worktrees cannot fork
 * dozens at once.
 */
function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            waiting.shift()?.();
          });
      };
      if (active < max) start();
      else waiting.push(start);
    });
}

async function cached<V>(
  cache: TtlCache<V>,
  key: string,
  load: () => Promise<V>,
  keep: (value: V) => boolean = () => true,
): Promise<V> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await load();
  if (keep(value)) cache.set(key, value);
  return value;
}

/**
 * Newest HEAD commit time across a workspace's repo worktrees, or null when none is readable.
 */
async function newestCommit(
  workspacePath: string,
  repoNames: string[],
  probe: (worktree: string) => Promise<number | null>,
): Promise<number | null> {
  const times = await Promise.all(
    repoNames.map((name) => probe(worktreePath(workspacePath, name))),
  );
  const known = times.filter((t): t is number => t !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/**
 * Folders with their repos, and every session worktree with its size and last commit time.
 *
 * @remarks Reads the full card set synchronously and never enqueues a store mutation, so a slow
 * `du` delays only this response, never a board frame. A failed probe reads as null or an empty
 * repo list instead of failing the response.
 * @see docs/ARCHITECTURE.md#workspaces-inventory
 */
export async function buildInventory(
  opts: { fresh: boolean },
  probes: InventoryProbes = REAL_PROBES,
): Promise<WorkspacesInventory> {
  if (opts.fresh) {
    sizes.clear();
    commits.clear();
    discoveries.clear();
  }
  const cards = store.listCards();
  const { folders } = store.getWorkspaceFolders();
  const rows = buildWorktreeRows(cards);
  const limit = createLimiter(MAX_IN_FLIGHT);

  const [folderEntries, filled] = await Promise.all([
    Promise.all(
      folders.map(async (folder) => ({
        path: folder,
        repos: await cached(discoveries, folder, () =>
          limit(() => probes.discoverRepos(folder)),
        ).catch((): DiscoveredRepo[] => []),
      })),
    ),
    Promise.all(
      rows.map(async (row) => {
        const [sizeKb, commitAt] = await Promise.all([
          cached(
            sizes,
            `${row.sessionId}:${row.workspacePath}`,
            () => limit(() => probes.diskUsageKb(row.workspacePath)),
            (kb) => kb !== null,
          ),
          cached(commits, `${row.sessionId}:${row.workspacePath}`, () =>
            newestCommit(row.workspacePath, row.repos, (wt) =>
              limit(() => probes.lastCommitAt(wt)),
            ),
          ),
        ]);
        return { ...row, sizeKb, lastCommitAt: commitAt };
      }),
    ),
  ]);

  let totalKb = 0;
  let unknownSizes = 0;
  for (const row of filled) {
    if (row.sizeKb === null) unknownSizes++;
    else totalKb += row.sizeKb;
  }
  return { folders: folderEntries, worktrees: filled, totalKb, unknownSizes };
}
