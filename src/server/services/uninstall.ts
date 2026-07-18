import fs from "node:fs";
import path from "node:path";
import { killSession, listSessions } from "../adapters/tmux.js";
import { findDspTtydOrphans, killTtydPids } from "../adapters/ttyd.js";
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
} from "./infra/paths.js";
import { worktreePath } from "./domain/workspace-paths.js";

/**
 * The three groups `uninstall` reasons about, produced once by `scanFootprint` and consumed by both
 * `renderPlan` and `runUninstall` — so what the user is shown and what is actually touched can never
 * drift apart.
 * @remarks `stop.ttydPids` holds the pids captured AT SCAN TIME, not a count to re-derive later:
 * `runUninstall` kills exactly this set, so a ttyd that starts between the scan and the (interactive,
 * possibly long) confirmation is never killed unseen. Rendered as a count only — the pids never reach
 * the user's terminal.
 */
export interface UninstallPlan {
  remove: string[];
  stop: { sessions: string[]; ttydPids: number[] };
  keep: { boardData: string[]; playbooks: string | null; worktrees: string[] };
}

/**
 * What `runUninstall` ACTUALLY did, as distinct from what it planned to do — the caller reports these
 * counts rather than the pre-execution plan's, so a file that survived (EACCES, EPERM, a path turned
 * directory) can never be reported as removed.
 */
export interface UninstallOutcome {
  plan: UninstallPlan;
  removed: string[];
  failed: { path: string; reason: string }[];
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
    stop: { sessions, ttydPids: await findDspTtydOrphans() },
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
 * @remarks The ttyd caveat is printed WITH the count, before the `[y/N]` prompt, because the ttyd
 * match is a process fingerprint that cannot be narrowed to dispatch (ttyd strips the
 * `=dsp-<session>` target from its own process line), so an unrelated `ttyd … tmux attach` on this
 * machine would otherwise be stopped without ever appearing in the plan the user approved.
 * Disclosure is the mitigation the adapter's scoping cannot provide.
 */
export function renderPlan(plan: UninstallPlan): string {
  const lines: string[] = [];

  if (plan.remove.length > 0) {
    lines.push("Remove:");
    for (const p of plan.remove) lines.push(`  ${p}`);
    lines.push("");
  }

  const ttydCount = plan.stop.ttydPids.length;
  if (plan.stop.sessions.length > 0 || ttydCount > 0) {
    lines.push("Stop:");
    for (const s of plan.stop.sessions) lines.push(`  tmux session ${s}`);
    if (ttydCount > 0) {
      lines.push(
        `  ${ttydCount} ttyd terminal process(es)`,
        `    Matched by process fingerprint, not by dispatch ownership — this`,
        `    includes ANY "ttyd … tmux attach" process on this machine, even one`,
        `    dispatch did not start.`,
      );
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
    lines.push(
      keepLines.length > 0
        ? "Nothing left to stop or remove — only the kept paths above remain."
        : "Nothing to stop or remove — dispatch's footprint is gone.",
      "",
    );
  }

  lines.push(PACKAGE_NOTE);
  return lines.join("\n");
}

/** Is there any live session or ttyd for `runUninstall` to stop? */
function hasStopWork(plan: UninstallPlan): boolean {
  return plan.stop.sessions.length > 0 || plan.stop.ttydPids.length > 0;
}

/**
 * Execute an already-scanned plan in the locked order — ttyd, then tmux, then files — reporting what
 * was ACTUALLY removed alongside the plan as it now stands, so the caller can re-render the Keep /
 * worktree report through the one renderer without claiming a failed delete succeeded.
 * @remarks Three invariants make this command safe to run, and each is load-bearing:
 * (1) it deletes ONLY the exact, constant paths the scan collected, one `rmSync(p)` per file — never
 * `{ recursive: true }`, never a directory, never a glob, and never `~/.dispatch` itself, which still
 * holds the user's playbooks;
 * (2) tmux targets come only from the `dsp-` filter AND are passed as `=<name>`, tmux's EXACT-match
 * prefix (mirroring cleanup.ts) — without the `=`, tmux prefix-matches and could kill a user session;
 * (3) git worktrees are listed for the user, NEVER removed, because they may hold uncommitted agent
 * work.
 * The ttyd kill has NO equivalent of (2) and must not be read as sharing it: ttyd strips the
 * `=dsp-<session>` target from its process line, so the fingerprint cannot be dsp-scoped and the
 * captured pids may include an unrelated `ttyd … tmux attach` process. What bounds that kill is
 * DISCLOSURE plus the plan snapshot — `renderPlan` states the match's true scope before the prompt,
 * and only the pids the user was shown a count of are killed here (never a fresh re-scan).
 * Steps stay best-effort and idempotent: an absent file (ENOENT), a dead tmux server, and an
 * already-exited ttyd are all SUCCESS, which is what makes a second run (or a half-removed footprint)
 * a clean no-op. A file that fails for a REAL reason (EACCES, EPERM, EISDIR) is reported, not
 * counted as removed and not swallowed — but it never aborts the remaining removals.
 */
export async function runUninstall(
  plan: UninstallPlan,
): Promise<UninstallOutcome> {
  killTtydPids(plan.stop.ttydPids);
  for (const session of plan.stop.sessions) {
    await killSession(`=${session}`);
  }

  const removed: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  for (const target of plan.remove) {
    try {
      fs.rmSync(target);
      removed.push(target);
    } catch (err) {
      const { code, message } = err as NodeJS.ErrnoException;
      if (code === "ENOENT") continue;
      failed.push({ path: target, reason: code ?? message });
    }
  }

  return {
    plan: { ...plan, remove: [], stop: { sessions: [], ttydPids: [] } },
    removed,
    failed,
  };
}
