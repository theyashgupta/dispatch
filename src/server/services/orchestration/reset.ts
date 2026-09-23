import path from "node:path";
import { store } from "../../store/board.store.js";
import { isResetEligible } from "../../../shared/reset-eligibility.js";
import { branchDelete, branchExists } from "../../adapters/git.js";
import { killSessionProcesses, removeWorkspaceFiles } from "./cleanup.js";

export type ResetOutcome =
  { ok: true } | { ok: false; status: 404 | 409 | 500; error: string };

/**
 * Reset a started card (LOCAL-20): kill its sessions, remove its workspaces and local branches,
 * then hand the store one mutation that detaches everything and moves the card to the Inbox.
 * @remarks Every teardown step is idempotent, and the store is touched only once all of them
 * succeeded, so a failed step leaves the card exactly as resettable as before. Runs inside the
 * card-scoped cleanup guard so a resume, cleanup or second reset cannot interleave with it.
 * @see docs/ARCHITECTURE.md#reset
 */
export async function resetCard(cardId: string): Promise<ResetOutcome> {
  const card = store.getCard(cardId);
  if (!card)
    return { ok: false, status: 404, error: `unknown card id: ${cardId}` };
  if (card.source === "group" || card.groupId != null) {
    return { ok: false, status: 409, error: "unwind the group instead" };
  }
  if (!isResetEligible(card)) {
    return {
      ok: false,
      status: 409,
      error: "nothing to reset: no session or workspace is attached",
    };
  }
  if (store.isStarting(cardId)) {
    return {
      ok: false,
      status: 409,
      error: "a start or resume is in flight for this card",
    };
  }
  if (store.isCleaningUp(cardId)) {
    return {
      ok: false,
      status: 409,
      error: "cleanup is in flight for this card",
    };
  }
  store.beginCleanup(cardId);
  try {
    const sessions = card.sessions?.length ? card.sessions : [card];
    for (const s of sessions) await killSessionProcesses(s.tmuxSession);

    const workspaceFailures: string[] = [];
    for (const s of sessions) {
      if (!s.workspacePath) continue;
      const repoPaths = s.workspace?.repos.map((r) => r.path) ?? [];
      const removed = await removeWorkspaceFiles(s.workspacePath, repoPaths);
      workspaceFailures.push(...removed.failures);
    }
    if (workspaceFailures.length > 0) {
      return {
        ok: false,
        status: 500,
        error: `Reset stopped while deleting the workspace (${workspaceFailures.join(", ")}). Run Reset again.`,
      };
    }

    const branchFailures: string[] = [];
    for (const s of sessions) {
      if (!s.branch) continue;
      for (const repoPath of s.workspace?.repos.map((r) => r.path) ?? []) {
        try {
          if (await branchExists(repoPath, s.branch)) {
            await branchDelete(repoPath, s.branch);
          }
        } catch {
          branchFailures.push(`${s.branch} in ${path.basename(repoPath)}`);
        }
      }
    }
    if (branchFailures.length > 0) {
      return {
        ok: false,
        status: 500,
        error: `Reset stopped while deleting the branch (${branchFailures.join(", ")}). Run Reset again.`,
      };
    }

    await store.resetCard(cardId);
    return { ok: true };
  } finally {
    store.endCleanup(cardId);
  }
}
