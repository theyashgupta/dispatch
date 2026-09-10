import { store } from "../../store/board.store.js";
import type { ArchivedGroup } from "../../../shared/types.js";
import {
  dirtyRepos,
  killSessionProcesses,
  removeWorkspaceFiles,
} from "./cleanup.js";

export type ArchiveDeleteOutcome =
  "deleted" | "blocked" | "failed" | "missing" | "restored" | "busy";

/**
 * Hard-delete an archived group's worktrees and folders (LOCAL-17); branches always survive.
 * @remarks Every workspace the archived sessions own goes through the Done cleanup saga's steps,
 * and the row is dropped only after every workspace is gone. Without `force` the dirty-worktree
 * preflight refuses and records the reason so the UI can offer Delete anyway; a failed removal
 * keeps the row with the failure recorded. The card-scoped cleanup bracket fences overlapping
 * deletes of one row, and a row whose group is live again (a restore whose row drop has not landed
 * yet, or a persist failure that left the row behind) is refused as `restored`, since deleting it
 * would remove a live card's worktrees.
 * @see docs/ARCHITECTURE.md#unwind-and-archive
 */
export async function deleteArchivedGroup(
  archiveId: string,
  force: boolean,
): Promise<ArchiveDeleteOutcome> {
  const row = store.getArchived(archiveId);
  if (!row) return "missing";
  if (store.getCard(archiveId)) return "restored";
  if (store.isCleaningUp(archiveId)) return "busy";
  store.beginCleanup(archiveId);
  try {
    return await deleteFiles(archiveId, row, force);
  } finally {
    store.endCleanup(archiveId);
  }
}

async function deleteFiles(
  archiveId: string,
  row: ArchivedGroup,
  force: boolean,
): Promise<ArchiveDeleteOutcome> {
  const targets = workspacesOf(row);
  if (!force) {
    for (const t of targets) {
      const { blocked, nonOrphanError } = await dirtyRepos(
        t.workspacePath,
        t.repoPaths,
      );
      if (blocked.length > 0) {
        const reason = blocked
          .map(
            (b) =>
              `${b.repo}: ${b.count} uncommitted change${b.count === 1 ? "" : "s"}`,
          )
          .join(", ");
        await store.recordArchiveDeleteBlocked(archiveId, reason);
        return "blocked";
      }
      if (nonOrphanError) {
        await store.recordArchiveDeleteBlocked(
          archiveId,
          "Preflight failed. A worktree could not be checked.",
        );
        return "blocked";
      }
    }
  }
  const failures: string[] = [];
  for (const t of targets) {
    await killSessionProcesses(t.tmuxSession);
    const removed = await removeWorkspaceFiles(t.workspacePath, t.repoPaths);
    failures.push(...removed.failures);
  }
  if (failures.length > 0) {
    await store.recordArchiveDeleteBlocked(
      archiveId,
      `Cleanup incomplete: ${failures.join(", ")}`,
    );
    return "failed";
  }
  return (await store.deleteArchived(archiveId)) ? "deleted" : "missing";
}

/** One entry per workspace the archived card owns: its session records, or the flat legacy fields. */
function workspacesOf(row: ArchivedGroup): {
  workspacePath: string;
  repoPaths: string[];
  tmuxSession: string | undefined;
}[] {
  const sessions = row.card.sessions?.length ? row.card.sessions : [row.card];
  return sessions.flatMap((s) =>
    s.workspacePath
      ? [
          {
            workspacePath: s.workspacePath,
            repoPaths: s.workspace?.repos.map((r) => r.path) ?? [],
            tmuxSession: s.tmuxSession,
          },
        ]
      : [],
  );
}
