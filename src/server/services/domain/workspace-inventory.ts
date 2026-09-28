import path from "node:path";
import type { Card, WorktreeRow } from "../../../shared/types.js";

/**
 * Build one inventory row per session record that owns a workspace, across every card.
 *
 * @remarks Sizes and commit times start null; the inventory service fills them from the disk.
 */
export function buildWorktreeRows(cards: readonly Card[]): WorktreeRow[] {
  const rows: WorktreeRow[] = [];
  for (const card of cards) {
    for (const session of card.sessions ?? []) {
      if (session.workspacePath == null) continue;
      rows.push({
        cardId: card.id,
        identifier: card.identifier,
        title: card.title,
        column: card.column,
        sessionId: session.id,
        active: session.id === card.activeSessionId,
        lost: session.tmuxSession == null,
        workspacePath: session.workspacePath,
        branch: session.branch ?? null,
        repos: (session.workspace?.repos ?? []).map((r) =>
          path.basename(r.path),
        ),
        sizeKb: null,
        lastCommitAt: null,
        cleanupDueAt: session.cleanupDueAt ?? null,
        blocked: session.cleanupBlocked ?? [],
      });
    }
  }
  return rows;
}
