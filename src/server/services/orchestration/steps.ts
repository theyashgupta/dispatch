import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CLAUDE_ARGS,
  type Card,
  type Config,
  type StartError,
} from "../../../shared/types.js";
import { sleep } from "../../adapters/exec.js";
import {
  branchExists,
  fetchBase,
  revParseVerify,
  worktreeAddExistingBranch,
  worktreeAddNewBranch,
  worktreeRegistered,
  worktreeRemove,
  worktreePrune,
  branchDelete,
} from "../../adapters/git.js";
import {
  capturePane,
  killSession,
  loadBuffer,
  newSession,
  pasteBuffer,
  sendKeys,
} from "../../adapters/tmux.js";
import { preSeedTrust } from "../../adapters/claude-trust.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";
import { store } from "../../store/board.store.js";
import { buildKickoff } from "../domain/kickoff.js";
import { parseClaudeArgs } from "../domain/claude-args.js";
import {
  getHooksRuntime,
  getOrchestrationConfig,
} from "../infra/config-holder.js";
import { newHookTokenValue, registerHookToken } from "../domain/hook-tokens.js";
import { HOOK_SETTINGS_PATH } from "../infra/paths.js";
import { worktreePath as buildWorktreePath } from "../domain/workspace-paths.js";

/** Linear identifier shape (defense-in-depth; the route also validates before we reach here). */
const IDENTIFIER_RE = /^[A-Za-z0-9]+-\d+$/;

/** Trust dialog signatures (02-RESEARCH § "Pattern 3", captured on Claude Code v2.1.200). */
const TRUST_DIALOG =
  /Yes, I trust this folder|Do you trust the files in this folder/;
/**
 * Bypass Permissions mode dialog (57-RESEARCH item 5, live-probed on Claude Code v2.1.214):
 * its default-focused option is "1. No, exit", not an accept — a blind Enter here would exit
 * the CLI outright, which is the actual mechanism behind the pre-fix first-ever-launch
 * repl-timeout. Requires its own detection and its own probe-verified accept sequence.
 */
const BYPASS_DIALOG = /Bypass Permissions mode/;
/**
 * REPL-ready footer — present only once the input box is live; absent in the trust dialog.
 * Claude Code changes this hint text between releases (v2.1.200 showed "? for shortcuts";
 * v2.1.201 shows "bypass permissions on (shift+tab to cycle)"), so match ANY known
 * ready-footer signature rather than one version's exact wording. Sessions launch with
 * `config.claudeArgs` (Settings ▸ Models, default `--dangerously-skip-permissions`), so the
 * "bypass permissions on" footer is reliably present only under the default; matching all three
 * signatures keeps readiness detection working whether or not the flag is present. All signatures
 * are footer chrome that the trust dialog never renders, preserving the "not matched until past
 * the trust prompt" property.
 */
const READY = /\? for shortcuts|bypass permissions on|shift\+tab to cycle/;

const READINESS_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const PASTE_SETTLE_MS = 500;

/**
 * Mutable saga bookkeeping. `run` records creations here; `undo` compensates against these
 * fields ONLY — never against values re-derived from the identifier (Pitfall 3).
 */
export interface SagaContext {
  card: Card;
  identifier: string;
  /**
   * The single naming token for this saga run: `card.identifier` for a card's first session, or
   * `` `${card.identifier}-${ordinal}` `` for session N. `identifier` beside it stays the BARE
   * ticket id because `IDENTIFIER_RE` validates that field and rejects a second hyphen-digit
   * group. The tmux session name, the branch name and the worktree directory are all functions of
   * `sessionName` and of nothing else, so they cannot disagree.
   */
  sessionName: string;
  /**
   * The reserved session's id; `undefined` for a card's first session. Not read by any step in
   * this plan — it exists so the runner can address `completeStart`/`rollbackReservedSession`
   * from one place, and so a later plan's retry/coalesce work has a home on `ctx`.
   */
  sessionId: string | undefined;
  /** Set by Step 1; consumed by later steps and by the runner's completeStart. */
  workspacePath: string;
  extraDirection: string;
  config: Config;
  createdWorkspaceDir: boolean;
  createdWorktrees: { repoPath: string; worktreePath: string }[];
  createdBranches: { repoPath: string; branch: string }[];
  tmuxSessionCreated: boolean;
  /**
   * True when this saga run is a RESTART of a previously-lost session (card.sessionLost). Threads
   * into the kickoff so the agent is told to `git status` first; also the condition under which an
   * already-registered worktree is expected (createWorktrees skips it rather than failing exit 128).
   */
  restarted: boolean;
  /**
   * Body of the selected playbook, resolved server-side by name; threaded into buildKickoff so the
   * saga kickoff uses it. Undefined ⇒ the playbook-less fallback that keeps the code.md path byte-
   * identical to today's kickoff.
   */
  playbookBody?: string;
  /** Non-fatal notices (e.g. fetch-fallback) surfaced on the card after a successful start. */
  warnings: string[];
  /**
   * The inherited parent session's branch, present only on an inherited start. A git REF (a
   * branch name), not a session id — `createWorktrees` needs a ref to build from, never a
   * record. Captured ONCE by the reserve step from `ReservedSession.parentBranch` and never
   * re-read from the store mid-saga, so there is no window for the parent's branch to change
   * out from under a running saga. LOCAL-ONLY: dispatch never pushes, so `origin/<this>` does
   * not exist — a consumer must not attempt to fetch it.
   */
  inheritBaseRef?: string;
}

type StartVariant = NonNullable<StartError["variant"]>;

/** A structured saga failure carrying the failed step, its stderr payload, and the UI variant. */
export class StartStepError extends Error {
  readonly step: string;
  readonly stderr: string;
  readonly variant: StartVariant;
  constructor(step: string, stderr: string, variant: StartVariant) {
    super(`${step}: ${stderr}`);
    this.name = "StartStepError";
    this.step = step;
    this.stderr = stderr;
    this.variant = variant;
  }
}

export interface SagaStep {
  /** Machine name → drives StartError.step. */
  name: string;
  /** Card line-3 copy while this step runs. */
  statusText: string;
  run(ctx: SagaContext): Promise<void>;
  /** Idempotent; operates only on ctx bookkeeping; swallows its own errors. */
  undo(ctx: SagaContext): Promise<void>;
}

/** Read `.stderr` off a thrown adapter error (execFile attaches it), falling back to the message. */
function stderrOf(err: unknown): string {
  const e = err as Error & { stderr?: string };
  return e.stderr && e.stderr.length > 0 ? e.stderr : e.message;
}

const prepareWorkspace: SagaStep = {
  name: "preparing workspace",
  statusText: "Preparing workspace…",
  async run(ctx) {
    if (!IDENTIFIER_RE.test(ctx.identifier)) {
      throw new StartStepError(
        "preparing workspace",
        `invalid ticket identifier: ${ctx.identifier}`,
        "generic",
      );
    }
    const workspaceRoot = ctx.config.workspaceRoot;
    if (!workspaceRoot) {
      throw new StartStepError(
        "preparing workspace",
        "workspaceRoot is not configured",
        "config",
      );
    }
    const workspacePath = path.join(workspaceRoot, ctx.sessionName);
    const resolvedRoot = path.resolve(workspaceRoot);
    if (!path.resolve(workspacePath).startsWith(resolvedRoot + path.sep)) {
      throw new StartStepError(
        "preparing workspace",
        `workspace path escapes workspaceRoot: ${workspacePath}`,
        "generic",
      );
    }
    ctx.workspacePath = workspacePath;
    ctx.createdWorkspaceDir = !fs.existsSync(workspacePath);
    await fsp.mkdir(workspacePath, { recursive: true });
  },
  async undo(ctx) {
    if (ctx.createdWorkspaceDir && ctx.workspacePath) {
      await fsp
        .rm(ctx.workspacePath, { recursive: true, force: true })
        .catch(() => {});
    }
  },
};

/**
 * Saga Step 2: create the per-repo worktrees, recording each creation onto `ctx` so undo can
 * compensate in reverse.
 * @remarks Runs the restart-idempotency check (`worktreeRegistered`) BEFORE the base-ref fetch, so
 * an existing-worktree restart never needs `baseRef` and an offline `git fetch` cannot fail a
 * repo that is skipped anyway (WR-03). Records only saga-created worktrees/branches, so undo never
 * removes a reused pre-existing branch (ORCH-01/03).
 *
 * An inherited start (`ctx.inheritBaseRef` set) skips `fetchBase` entirely and cuts from the
 * parent's local branch directly, with no warning: the parent's branch is local-only (dispatch
 * never pushes), so a fetch of it can only fail, and routing that failure through the ordinary
 * catch would emit a user-visible `git fetch origin … failed` warning on every single inherited
 * start while still succeeding — working by accident, through the error path. The fallback to
 * this repo's own configured base is evaluated per repo, not once for the whole saga, because one
 * `sessionName` token spans every repo but a parent whose start partially failed may not have its
 * branch in all of them; that per-repo miss is the one case where a warning is genuinely
 * informative. The leading-dash argument-injection guard applies to the inherited ref for the same
 * reason it applies to the configured base: both reach `git worktree add`'s argument vector
 * regardless of where the value originated.
 * @see docs/ARCHITECTURE.md#orchestration-saga
 * @see docs/ARCHITECTURE.md#session-inheritance
 */
const createWorktrees: SagaStep = {
  name: "creating worktrees",
  statusText: "Creating worktrees…",
  async run(ctx) {
    if (ctx.inheritBaseRef?.startsWith("-")) {
      throw new StartStepError(
        "creating worktrees",
        "inherited base branch must not start with '-'",
        "config",
      );
    }
    for (const { path: repoPath, base } of ctx.card.workspace?.repos ?? []) {
      if (base.startsWith("-")) {
        throw new StartStepError(
          "creating worktrees",
          "base branch must not start with '-'",
          "config",
        );
      }
      await worktreePrune(repoPath);

      const worktreePath = buildWorktreePath(ctx.workspacePath, repoPath);

      if (await worktreeRegistered(repoPath, worktreePath)) {
        continue;
      }

      let baseRef: string;
      const inheritedLocally =
        ctx.inheritBaseRef != null &&
        (await revParseVerify(repoPath, "refs/heads/" + ctx.inheritBaseRef));
      if (inheritedLocally) {
        baseRef = ctx.inheritBaseRef as string;
      } else {
        if (ctx.inheritBaseRef != null) {
          ctx.warnings.push(
            `inherited branch ${ctx.inheritBaseRef} not found in ${path.basename(repoPath)}, cut from ${base}`,
          );
        }
        try {
          await fetchBase(repoPath, base);
          baseRef = "origin/" + base;
        } catch (err) {
          ctx.warnings.push(
            `git fetch origin ${base} failed in ${path.basename(repoPath)}, cut from local ${base}`,
          );
          const hasLocalBase = await revParseVerify(
            repoPath,
            "refs/heads/" + base,
          );
          if (!hasLocalBase) {
            throw new StartStepError(
              "creating worktrees",
              stderrOf(err),
              "config",
            );
          }
          baseRef = base;
        }
      }

      if (await branchExists(repoPath, ctx.sessionName)) {
        try {
          await worktreeAddExistingBranch(
            repoPath,
            worktreePath,
            ctx.sessionName,
          );
        } catch (err) {
          const raw = stderrOf(err);
          if (raw.includes("is already used by worktree at")) {
            throw new StartStepError(
              "creating worktrees",
              `Branch ${ctx.sessionName} is attached to another worktree.\n${raw}`,
              "branch-conflict",
            );
          }
          throw new StartStepError("creating worktrees", raw, "generic");
        }
        ctx.createdWorktrees.push({ repoPath, worktreePath });
      } else {
        try {
          await worktreeAddNewBranch(
            repoPath,
            worktreePath,
            ctx.sessionName,
            baseRef,
          );
        } catch (err) {
          throw new StartStepError(
            "creating worktrees",
            stderrOf(err),
            "generic",
          );
        }
        ctx.createdWorktrees.push({ repoPath, worktreePath });
        ctx.createdBranches.push({ repoPath, branch: ctx.sessionName });
      }
    }
  },
  async undo(ctx) {
    for (const { repoPath, worktreePath } of ctx.createdWorktrees) {
      await worktreeRemove(repoPath, worktreePath).catch(() => {});
    }
    for (const { repoPath, branch } of ctx.createdBranches) {
      await branchDelete(repoPath, branch).catch(() => {});
    }
  },
};

/**
 * Poll a freshly-launched tmux session until the Claude REPL is interactive, accepting the trust
 * dialog once if it appears and throwing on the 30s budget. Extracted from `startClaude` so the
 * resume saga can reuse the identical readiness contract and the READY/TRUST_DIALOG signatures and
 * timeout budget stay single-sourced; on timeout it throws the same `StartStepError` the start
 * flow surfaces, keeping `startClaude`'s observable behaviour unchanged.
 * @remarks (`NEW-13`, Phase 96 R2) `capturePane`/`sendKeys` are pane-level targets and require the
 * TRAILING-COLON exact-match form (`=<name>:`), built once here rather than at each call site, so
 * a suffixed sibling session can never be silently prefix-matched once the exact session is gone.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 * @see docs/ARCHITECTURE.md#in-review-lifecycle
 */
export async function awaitReplReady(session: string): Promise<void> {
  const paneTarget = `=${session}:`;
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  let trustAccepted = false;
  let bypassAccepted = false;
  let lastPane = "";
  while (Date.now() < deadline) {
    lastPane = await capturePane(paneTarget);
    if (READY.test(lastPane)) return;
    if (!trustAccepted && TRUST_DIALOG.test(lastPane)) {
      await sendKeys(paneTarget, ["Enter"]);
      trustAccepted = true;
    }
    if (!bypassAccepted && BYPASS_DIALOG.test(lastPane)) {
      await sendKeys(paneTarget, ["Down"]);
      await sendKeys(paneTarget, ["Enter"]);
      bypassAccepted = true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new StartStepError("starting claude", lastPane, "repl-timeout");
}

/**
 * Saga Step 3: launch the claude REPL in a detached tmux session. When the installed CLI meets
 * the hooks capability floor, the launch carries the dispatch settings layer (`--settings`) plus
 * the three per-session `DISPATCH_*` env vars via tmux `-e`; the token is minted BEFORE the
 * session exists so the kickoff paste's UserPromptSubmit hook already authenticates (the
 * flip-back it triggers no-ops — the card is never in needs_input during the saga). The
 * `hookRoutedAt` routing latch is deliberately NOT stamped here (`WR-05`): it is evidence that
 * hook events arrive, and only that first authenticated event may write it. Below floor or under
 * `statusChannel: "pane"` the launch
 * is byte-identical to the pre-hooks argv (no settings, no token, no env), and the pane watcher
 * carries status alone; that branch first resets the card's hook-channel state so a stale
 * persisted latch/token from an earlier hook-capable session can never survive into a
 * hook-silent one.
 * @remarks (Phase 91) The mint/register sequencing hazard is closed structurally, not by
 * ordering discipline: `store.mintHookChannel` persists the token onto the session record AND
 * reports which session it landed on, and ONLY THEN is the token registered against that real
 * id — there is no path left that can register a token before the session it names exists. If
 * `mintHookChannel` reports no session — an unknown card id, or an active pointer naming no
 * record (`WR-03`) — registration is skipped and the launch falls through to the hook-silent
 * branch, the existing safe degradation for a card the store cannot resolve.
 * @remarks (Phase 94, corrected Phase 96 `R2`) tmux resolves a `-t` target by PREFIX when no exact
 * match exists, so once a suffixed sibling can coexist with the bare session (`dsp-PROJ-123-2`
 * beside `dsp-PROJ-123`), every target built from a name that can be a prefix of a sibling's must
 * use the `=` exact-match form — live-reproduced on tmux 3.6a, not theoretical. `undo` below
 * applies the session-level form (`=<name>`, no colon); `send-keys`/`capture-pane` need the SAME
 * exact-match protection but as pane-level targets require a TRAILING COLON (`=<name>:`) to
 * resolve at all — `awaitReplReady` and `sendKickoff` build that form once, internally.
 * @remarks (Phase 96 finding `F-96-A`) `ctx.sessionId` (the reserved session's id, `undefined` for
 * a card's first session) is threaded into `resetClaudeSessionId` and `mintHookChannel` so a
 * `newSession:true` launch targets the session actually being started rather than defaulting to
 * `card.activeSessionId` — the OLD, still-live session for exactly this launch, since
 * `reserveNewSession` does not promote the new session until `completeStart` succeeds
 * (`D-NOPROMOTE-ON-RESERVE`). Before this fix the default silently minted the new launch's
 * credential onto the wrong session (leaving the new session unauthenticated) and reset the wrong
 * session's `claudeSessionId` (wiping an unrelated sibling's `--resume` capability). The reserved
 * session's own previous token is always none (it has never held one), so `previousToken` is
 * computed only for the `ctx.sessionId === undefined` case — never read off the card's flat
 * mirror when targeting a reserved sibling, which would otherwise revoke the unrelated active
 * session's own still-valid token.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
const startClaude: SagaStep = {
  name: "starting claude",
  statusText: "Starting Claude…",
  async run(ctx) {
    const session = "dsp-" + ctx.sessionName;
    await preSeedTrust(ctx.workspacePath);
    await store.resetClaudeSessionId(ctx.card.id, ctx.sessionId);

    const claudePath = (await resolveBinaryPath("claude")) ?? "claude";
    const claudeArgs = parseClaudeArgs(
      getOrchestrationConfig()?.claudeArgs ?? DEFAULT_CLAUDE_ARGS,
    );
    const runtime = getHooksRuntime();
    let launchedHooksCapable = false;
    if (runtime?.capable && runtime.statusChannel !== "pane") {
      const previousToken =
        ctx.sessionId === undefined
          ? store.getCard(ctx.card.id)?.hookToken
          : undefined;
      const token = newHookTokenValue();
      const sessionId = await store.mintHookChannel(
        ctx.card.id,
        token,
        ctx.sessionId,
      );
      if (sessionId !== undefined) {
        registerHookToken(token, ctx.card.id, sessionId, previousToken);
        await newSession(
          session,
          ctx.workspacePath,
          [claudePath, "--settings", HOOK_SETTINGS_PATH, ...claudeArgs],
          {
            DISPATCH_HOOK_PORT: String(runtime.port),
            DISPATCH_HOOK_TOKEN: token,
            DISPATCH_CARD_ID: ctx.card.id,
          },
        );
        launchedHooksCapable = true;
      }
    }
    if (!launchedHooksCapable) {
      await store.clearHookChannel(ctx.card.id);
      await newSession(session, ctx.workspacePath, [claudePath, ...claudeArgs]);
    }
    ctx.tmuxSessionCreated = true;

    await awaitReplReady(session);
  },
  async undo(ctx) {
    if (ctx.tmuxSessionCreated) {
      await killSession(`=dsp-${ctx.sessionName}`).catch(() => {});
    }
  },
};

const sendKickoff: SagaStep = {
  name: "sending kickoff",
  statusText: "Sending kickoff…",
  async run(ctx) {
    const session = "dsp-" + ctx.sessionName;
    const repoNames = (ctx.card.workspace?.repos ?? []).map((r) =>
      path.basename(r.path),
    );
    const members = (ctx.card.memberIds ?? [])
      .map((id) => store.getCard(id))
      .filter((c): c is Card => c != null);
    const kickoff = buildKickoff(ctx.card, ctx.extraDirection, repoNames, {
      restarted: ctx.restarted,
      playbookBody: ctx.playbookBody,
      members,
      builtFromBranch: ctx.inheritBaseRef,
    });
    const tmpFile = path.join(
      os.tmpdir(),
      `dsp-kickoff-${ctx.sessionName}-${Date.now()}.txt`,
    );
    await fsp.writeFile(tmpFile, kickoff, "utf8");
    const paneTarget = `=${session}:`;
    try {
      await loadBuffer(session, tmpFile);
      await pasteBuffer(session, paneTarget);
      await sleep(PASTE_SETTLE_MS);
      await sendKeys(paneTarget, ["Enter"]);
    } finally {
      await fsp.unlink(tmpFile).catch(() => {});
    }
  },
  async undo() {},
};

/** The four steps, in forward execution order. */
export const steps: SagaStep[] = [
  prepareWorkspace,
  createWorktrees,
  startClaude,
  sendKickoff,
];
