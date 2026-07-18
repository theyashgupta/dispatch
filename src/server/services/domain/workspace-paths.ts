import path from "node:path";

/** Build the worktree path for `repoPath` under a ticket's `workspacePath`. */
export function worktreePath(workspacePath: string, repoPath: string): string {
  return path.join(workspacePath, path.basename(repoPath));
}
