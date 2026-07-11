import path from "node:path";
import fsp from "node:fs/promises";
import { store } from "../store/board.store.js";
import { killTtyd } from "../adapters/ttyd.js";
import { killSession } from "../adapters/tmux.js";
import { worktreeRemove, worktreePrune } from "../adapters/git.js";
import { worktreePath as buildWorktreePath } from "./workspace-paths.js";

/**
 * Tear down a Done card's workspace: kill ttyd + the tmux session, remove each repo's worktree, and
 * remove the per-ticket workspace folder — ALWAYS keeping branches. Idempotent / no-op tolerant: a
 * card with no session and no workspace skips every step and still calls finishCleanup (quiet 202).
 * On any partial failure records a muted cleanupWarning instead of finishing quietly.
 * @remarks NEW-14 delete-before-kill ordering: killTtyd deletes the tracked entry BEFORE killing so
 * the orphan-sweep cannot re-adopt it, then killSession, then per-repo worktreeRemove, then fs.rm the
 * workspace folder, then worktreePrune last (once the directories are gone). Every step is idempotent
 * and no-op tolerant, and branches are ALWAYS kept.
 * @see docs/ARCHITECTURE.md#cleanup-lifecycle
 */
export async function cleanupWorkspace(cardId: string): Promise<void> {
  const card = store.getCard(cardId);
  if (!card) return;

  const session = card.tmuxSession;
  const workspacePath = card.workspacePath;
  const repoPaths = card.workspace?.repos.map((r) => r.path) ?? [];
  const isLegacyWorkspace = Boolean(workspacePath) && !card.workspace;

  const failures: string[] = [];

  if (session) {
    killTtyd(session);
  }

  if (session) {
    await killSession(`=${session}`);
  }

  if (workspacePath) {
    for (const repoPath of repoPaths) {
      const worktreePath = buildWorktreePath(workspacePath, repoPath);
      const exists = await fsp.stat(worktreePath).then(
        () => true,
        () => false,
      );
      if (!exists) continue;
      try {
        await worktreeRemove(repoPath, worktreePath);
      } catch {
        failures.push(path.basename(repoPath));
      }
    }

    await fsp
      .rm(workspacePath, { recursive: true, force: true })
      .catch(() => failures.push("workspace folder"));

    for (const repoPath of repoPaths) {
      await worktreePrune(repoPath).catch(() => {});
    }
  }

  if (failures.length > 0) {
    await store.recordCleanupWarning(
      cardId,
      "Cleanup incomplete — some worktrees may remain.",
    );
  } else if (isLegacyWorkspace) {
    await store.recordCleanupWarning(
      cardId,
      "Cleanup kept worktree registrations — this ticket predates per-ticket workspaces.",
    );
  } else {
    await store.finishCleanup(cardId);
  }
}
