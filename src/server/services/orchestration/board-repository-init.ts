import fsp from "node:fs/promises";
import path from "node:path";
import type { Board, BoardKey } from "../../../shared/types.js";
import {
  commitEmpty,
  currentBranch,
  initMainRepository,
  isRepositoryTop,
  revParseVerify,
} from "../../adapters/git.js";
import {
  boardRefusal,
  getBoard,
  repositoryEntry,
  resolveBoardForCreate,
  updateBoard,
} from "./boards.js";

function gitFailure(err: unknown) {
  const stderr = (err as { stderr?: unknown }).stderr;
  const detail = typeof stderr === "string" ? stderr.trim() : "";
  return boardRefusal(
    "git-init-failed",
    detail === "" ? undefined : { detail },
  );
}

/**
 * Make a local git repository for a board and add it to the board.
 *
 * @remarks The repository sits in a subfolder named with the lowercase key, because sessions live
 * in the board folder and a repository at the folder itself would list every session folder as
 * untracked. A subfolder that already holds a repository is added on its current branch (none when
 * HEAD is detached), and a repository with no commit gets an empty one. Nothing touches the network.
 */
export async function initBoardRepository(key: BoardKey): Promise<Board> {
  resolveBoardForCreate(key);
  const board = getBoard(key);
  if (board.workspaceRoot === null) throw boardRefusal("no-workspaces-root");
  const target = path.join(board.workspaceRoot, key.toLowerCase());
  let baseBranch: string | null;
  try {
    await fsp.mkdir(target, { recursive: true });
    if (!(await isRepositoryTop(target))) await initMainRepository(target);
    if (!(await revParseVerify(target, "HEAD"))) await commitEmpty(target);
    const branch = await currentBranch(target);
    baseBranch = branch === "HEAD" ? null : branch;
  } catch (err) {
    throw gitFailure(err);
  }
  const fresh = getBoard(key);
  if (fresh.repositories.some((repo) => repo.path === target)) return fresh;
  const known = new Map(fresh.repositories.map((repo) => [repo.path, repo]));
  return updateBoard(
    key,
    { repositories: [...known.values(), repositoryEntry(target, baseBranch)] },
    target,
  );
}
