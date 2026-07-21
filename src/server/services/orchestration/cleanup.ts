import path from "node:path";
import fsp from "node:fs/promises";
import { store } from "../../store/board.store.js";
import { killTtyd } from "../../adapters/ttyd.js";
import { killSession } from "../../adapters/tmux.js";
import {
  worktreeRemove,
  worktreePrune,
  worktreeStatus,
} from "../../adapters/git.js";
import { worktreePath as buildWorktreePath } from "../domain/workspace-paths.js";

/**
 * Env-gated measurement instrumentation for the perf-cleanup harness (PERF-01), dead on every
 * normal path: `perfCleanup` is the only allocation that exists when `DISPATCH_PERF_CLEANUP` is
 * unset, and it is read nowhere else in {@link cleanupWorkspace} besides the timing brackets and
 * the final stderr dump, both of which are no-ops when it is `false`.
 * @remarks Mirrors `src/server/adapters/exec.ts`'s `DISPATCH_PERF_EXEC`/`DISPATCH_PERF_EXEC_DUMP`
 * shape exactly, so `scripts/perf-cleanup.mjs` can reuse the same stderr-dump-line idiom
 * `scripts/perf-subproc.mjs` already parses for that sibling harness.
 */
const perfCleanup = process.env.DISPATCH_PERF_CLEANUP === "1";

/**
 * Tear down a Done card's workspace: kill ttyd + the tmux session, remove each repo's worktree, and
 * remove the per-ticket workspace folder — ALWAYS keeping branches. Idempotent / no-op tolerant: a
 * card with no session and no workspace skips every step and still calls finishCleanup (quiet 202).
 * On any partial failure records a muted cleanupWarning instead of finishing quietly.
 * @remarks NEW-14 delete-before-kill ordering: killTtyd deletes the tracked entry BEFORE killing so
 * the orphan-sweep cannot re-adopt it, then killSession, then per-repo worktreeRemove, then fs.rm the
 * workspace folder, then worktreePrune last (once the directories are gone). Every step is idempotent
 * and no-op tolerant, and branches are ALWAYS kept.
 * @remarks Preflight (PRE-01/PRE-03/PRE-04): unless `force`, a read-only `git status` probes each
 * repo's worktree ABOVE any destructive step — a dirty repo refuses with zero teardown (records
 * cleanupBlocked, keeps the session/ttyd/worktrees alive), a non-orphan git error refuses with a
 * muted warning, and orphan/clean/missing repos fall through to the unchanged NEW-14 teardown.
 * `force: true` skips the probe entirely and tears down byte-identically to the pre-preflight path.
 * @remarks Per-step timing (PERF-01, `DISPATCH_PERF_CLEANUP=1`): five `performance.now()` brackets —
 * preflight, the kill pair, worktree-remove, fs.rm, and prune — plus a total spanning the whole
 * function body, dumped as one `DISPATCH_PERF_CLEANUP_STEPS` stderr line right before the terminal
 * decision below, so `scripts/perf-cleanup.mjs` can answer whether fs.rm or the git loops dominate
 * teardown latency without guessing.
 * @see docs/ARCHITECTURE.md#cleanup-lifecycle
 */
export async function cleanupWorkspace(
  cardId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const totalT0 = perfCleanup ? performance.now() : 0;
  const card = store.getCard(cardId);
  if (!card) return;

  const session = card.tmuxSession;
  const workspacePath = card.workspacePath;
  const repoPaths = card.workspace?.repos.map((r) => r.path) ?? [];
  const isLegacyWorkspace = Boolean(workspacePath) && !card.workspace;

  await store.clearCleanupBlocked(cardId);

  const preflightT0 = perfCleanup ? performance.now() : 0;
  if (!opts.force && workspacePath) {
    const blocked: { repo: string; count: number }[] = [];
    let nonOrphanError = false;
    for (const repoPath of repoPaths) {
      const worktreePath = buildWorktreePath(workspacePath, repoPath);
      const exists = await fsp.stat(worktreePath).then(
        () => true,
        () => false,
      );
      if (!exists) continue;
      const st = await worktreeStatus(worktreePath);
      if (st.kind === "dirty") {
        blocked.push({ repo: path.basename(repoPath), count: st.count });
      } else if (st.kind === "error") {
        nonOrphanError = true;
      }
    }
    if (blocked.length > 0) {
      await store.recordCleanupBlocked(cardId, blocked);
      return;
    }
    if (nonOrphanError) {
      await store.noteCleanupWarning(
        cardId,
        "Cleanup preflight failed — a worktree could not be checked.",
      );
      return;
    }
  }
  const preflightMs = perfCleanup ? performance.now() - preflightT0 : 0;

  const failures: string[] = [];

  const killT0 = perfCleanup ? performance.now() : 0;
  if (session) {
    killTtyd(session);
  }

  if (session) {
    await killSession(`=${session}`);
  }
  const killMs = perfCleanup ? performance.now() - killT0 : 0;

  let worktreeRemoveMs = 0;
  let fsRmMs = 0;
  let pruneMs = 0;
  if (workspacePath) {
    const removeT0 = perfCleanup ? performance.now() : 0;
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
    worktreeRemoveMs = perfCleanup ? performance.now() - removeT0 : 0;

    const rmT0 = perfCleanup ? performance.now() : 0;
    await fsp
      .rm(workspacePath, { recursive: true, force: true })
      .catch(() => failures.push("workspace folder"));
    fsRmMs = perfCleanup ? performance.now() - rmT0 : 0;

    const pruneT0 = perfCleanup ? performance.now() : 0;
    for (const repoPath of repoPaths) {
      await worktreePrune(repoPath).catch(() => {});
    }
    pruneMs = perfCleanup ? performance.now() - pruneT0 : 0;
  }

  if (perfCleanup) {
    const totalMs = performance.now() - totalT0;
    process.stderr.write(
      "DISPATCH_PERF_CLEANUP_STEPS " +
        JSON.stringify({
          repos: repoPaths.length,
          preflight_ms: preflightMs,
          kill_ms: killMs,
          worktree_remove_ms: worktreeRemoveMs,
          fs_rm_ms: fsRmMs,
          prune_ms: pruneMs,
          total_ms: totalMs,
        }) +
        "\n",
    );
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
