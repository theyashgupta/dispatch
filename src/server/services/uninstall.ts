import fs from "node:fs";
import path from "node:path";
import { killSession, listSessions } from "../adapters/tmux.js";
import { findDspTtydOrphans, killDspTtydOrphans } from "../adapters/ttyd.js";
import {
  BACKUP_SLOTS,
  BOARD_DB_PATH,
  readWorkspaceRegistry,
} from "../store/board-db.js";
import {
  CONFIG_PATH,
  DISPATCH_DIR,
  HOOK_SCRIPT_PATH,
  HOOK_SETTINGS_PATH,
} from "./paths.js";
import { worktreePath } from "./workspace-paths.js";

/**
 * The three groups `uninstall` reasons about, produced once by `scanFootprint` and consumed by both
 * `renderPlan` and `runUninstall` — so what the user is shown and what is actually touched can never
 * drift apart.
 */
export interface UninstallPlan {
  remove: string[];
  stop: { sessions: string[]; ttydCount: number };
  keep: { boardData: string[]; playbooks: string | null; worktrees: string[] };
}

const PACKAGE_NOTE =
  `The dispatch package itself is left installed — a running process cannot delete itself.\n` +
  `  Remove it with:  npm uninstall -g @theyashgupta/dispatch\n` +
  `  Or, if you ran it via npx, clear the npx cache.\n`;

/** Board-data paths a user recognizes: the primary plus whichever `.bak.N` slots exist. */
function boardDataPaths(): string[] {
  const slots = Array.from(
    { length: BACKUP_SLOTS },
    (_, i) => `${BOARD_DB_PATH}.bak.${i + 1}`,
  );
  return [BOARD_DB_PATH, ...slots].filter((p) => fs.existsSync(p));
}

/**
 * The WAL/SHM sidecars, swept only alongside a `--purge` of the primary. Deliberately excluded from
 * the Keep listing: they are engine internals a user never reasons about, and leaving them behind
 * once board.db is gone would strand a WAL that could poison a later fresh database.
 */
function boardSidecarPaths(): string[] {
  return [`${BOARD_DB_PATH}-wal`, `${BOARD_DB_PATH}-shm`].filter((p) =>
    fs.existsSync(p),
  );
}

/**
 * Every worktree the board knows about, as an absolute path the user can hand to
 * `git worktree remove`. `repos[].path` is the SOURCE repo, never the worktree — the worktree is
 * `worktreePath(workspacePath, repoPath)` (the same join steps/cleanup use), so listing the raw repo
 * path here would point the user at their primary checkout instead. A legacy card with no
 * `workspace` snapshot falls back to its workspace folder, which contains the worktrees.
 */
function scanWorktrees(): string[] {
  const out = new Set<string>();
  for (const { workspacePath, repoPaths } of readWorkspaceRegistry()) {
    if (repoPaths.length === 0) {
      out.add(workspacePath);
      continue;
    }
    for (const repoPath of repoPaths) {
      out.add(worktreePath(workspacePath, repoPath));
    }
  }
  return [...out].sort();
}

/**
 * Build the uninstall plan with a PURELY READ-ONLY probe — existence checks, `listSessions`, a
 * fingerprint scan, and a read-only registry read. It writes nothing, kills nothing, and creates
 * nothing, which is what makes `--dry-run` honest and what lets the confirmation prompt show the
 * exact set `runUninstall` will act on.
 * @remarks The worktree registry is read HERE, before any deletion, so `--purge` can still print the
 * worktree list after board.db is gone — otherwise purging would delete the registry and silently
 * orphan worktrees the user could never find again.
 */
export async function scanFootprint(opts: {
  purge: boolean;
}): Promise<UninstallPlan> {
  const footprint = [CONFIG_PATH, HOOK_SCRIPT_PATH, HOOK_SETTINGS_PATH].filter(
    (p) => fs.existsSync(p),
  );
  const boardData = boardDataPaths();
  const playbooks = path.join(DISPATCH_DIR, "playbooks");
  const sessions = [...(await listSessions())]
    .filter((s) => s.startsWith("dsp-"))
    .sort();

  return {
    remove: opts.purge
      ? [...footprint, ...boardData, ...boardSidecarPaths()]
      : footprint,
    stop: { sessions, ttydCount: (await findDspTtydOrphans()).length },
    keep: {
      boardData: opts.purge ? [] : boardData,
      playbooks: fs.existsSync(playbooks) ? playbooks : null,
      worktrees: scanWorktrees(),
    },
  };
}

/**
 * THE single plan renderer — `--dry-run`, the confirmation prompt, and the post-run report all call
 * this, so the user reads one consistent description of the same scan. Empty sections are omitted
 * (a fully-uninstalled box renders a short no-op plan, not three bare headings), and the output
 * always closes with the package note since uninstall can never remove the package itself.
 */
export function renderPlan(plan: UninstallPlan): string {
  const lines: string[] = [];

  if (plan.remove.length > 0) {
    lines.push("Remove:");
    for (const p of plan.remove) lines.push(`  ${p}`);
    lines.push("");
  }

  if (plan.stop.sessions.length > 0 || plan.stop.ttydCount > 0) {
    lines.push("Stop:");
    for (const s of plan.stop.sessions) lines.push(`  tmux session ${s}`);
    if (plan.stop.ttydCount > 0) {
      lines.push(`  ${plan.stop.ttydCount} ttyd terminal process(es)`);
    }
    lines.push("");
  }

  const keepLines: string[] = [];
  for (const p of plan.keep.boardData) {
    keepLines.push(`  ${p}  (board data — pass --purge to delete)`);
  }
  if (plan.keep.playbooks) {
    keepLines.push(
      `  ${plan.keep.playbooks}  (your playbooks — kept even with --purge)`,
    );
  }
  if (plan.keep.worktrees.length > 0) {
    keepLines.push("  Git worktrees are never deleted — remove them yourself:");
    for (const w of plan.keep.worktrees) {
      keepLines.push(`    git worktree remove ${w}`);
    }
  }
  if (keepLines.length > 0) {
    lines.push("Keep:", ...keepLines, "");
  }

  if (plan.remove.length === 0 && !hasStopWork(plan)) {
    lines.push("Nothing to stop or remove — dispatch's footprint is gone.", "");
  }

  lines.push(PACKAGE_NOTE);
  return lines.join("\n");
}

/** Is there any live session or ttyd for `runUninstall` to stop? */
function hasStopWork(plan: UninstallPlan): boolean {
  return plan.stop.sessions.length > 0 || plan.stop.ttydCount > 0;
}

/**
 * Execute an already-scanned plan in the locked order — ttyd, then tmux, then files — and return the
 * plan as it now stands (nothing left to stop or remove) so the caller can re-render the Keep /
 * worktree report through the one renderer.
 * @remarks Three invariants make this command safe to run, and each is load-bearing:
 * (1) it deletes ONLY the exact, constant paths the scan collected, one `rmSync(p, { force: true })`
 * per file — never `{ recursive: true }`, never a directory, never a glob, and never `~/.dispatch`
 * itself, which still holds the user's playbooks;
 * (2) tmux targets come only from the `dsp-` filter AND are passed as `=<name>`, tmux's EXACT-match
 * prefix (mirroring cleanup.ts) — without the `=`, tmux prefix-matches and could kill a user session;
 * (3) git worktrees are listed for the user, NEVER removed, because they may hold uncommitted agent
 * work.
 * Every step is best-effort: an absent file, a dead tmux server, and a missing ttyd are all SUCCESS,
 * which is what makes a second run (or a half-removed footprint) a clean no-op rather than an error.
 */
export async function runUninstall(
  plan: UninstallPlan,
): Promise<UninstallPlan> {
  await killDspTtydOrphans();
  for (const session of plan.stop.sessions) {
    await killSession(`=${session}`);
  }
  for (const target of plan.remove) {
    try {
      fs.rmSync(target, { force: true });
    } catch {}
  }
  return { ...plan, remove: [], stop: { sessions: [], ttydCount: 0 } };
}
