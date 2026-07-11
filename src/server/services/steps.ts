import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Card, Config, StartError } from "../../shared/types.js";
import { sleep } from "../adapters/exec.js";
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
} from "../adapters/git.js";
import {
  capturePane,
  killSession,
  loadBuffer,
  newSession,
  pasteBuffer,
  sendKeys,
} from "../adapters/tmux.js";
import { preSeedTrust } from "../adapters/claude-trust.js";
import { resolveBinaryPath } from "../adapters/resolve-binary.js";
import { store } from "../store/board.store.js";
import { buildKickoff } from "./kickoff.js";
import { getHooksRuntime } from "./config-holder.js";
import { mintHookToken } from "./hook-tokens.js";
import { HOOK_SETTINGS_PATH } from "./paths.js";
import { worktreePath as buildWorktreePath } from "./workspace-paths.js";

/** Linear identifier shape (defense-in-depth; the route also validates before we reach here). */
const IDENTIFIER_RE = /^[A-Za-z0-9]+-\d+$/;

/** Trust dialog signatures (02-RESEARCH § "Pattern 3", captured on Claude Code v2.1.200). */
const TRUST_DIALOG =
  /Yes, I trust this folder|Do you trust the files in this folder/;
/**
 * REPL-ready footer — present only once the input box is live; absent in the trust dialog.
 * Claude Code changes this hint text between releases (v2.1.200 showed "? for shortcuts";
 * v2.1.201 shows "bypass permissions on (shift+tab to cycle)"), so match ANY known
 * ready-footer signature rather than one version's exact wording. Because sessions launch
 * with --dangerously-skip-permissions, the "bypass permissions on" footer is reliably present.
 * All signatures are footer chrome that the trust dialog never renders, preserving the
 * "not matched until past the trust prompt" property.
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
    const workspacePath = path.join(workspaceRoot, ctx.identifier);
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
 * @see docs/ARCHITECTURE.md#orchestration-saga
 */
const createWorktrees: SagaStep = {
  name: "creating worktrees",
  statusText: "Creating worktrees…",
  async run(ctx) {
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
      try {
        await fetchBase(repoPath, base);
        baseRef = "origin/" + base;
      } catch (err) {
        ctx.warnings.push(
          `git fetch origin ${base} failed in ${path.basename(repoPath)} — cut from local ${base}`,
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

      if (await branchExists(repoPath, ctx.identifier)) {
        try {
          await worktreeAddExistingBranch(
            repoPath,
            worktreePath,
            ctx.identifier,
          );
        } catch (err) {
          const raw = stderrOf(err);
          if (raw.includes("is already used by worktree at")) {
            throw new StartStepError(
              "creating worktrees",
              `Branch ${ctx.identifier} is attached to another worktree.\n${raw}`,
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
            ctx.identifier,
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
        ctx.createdBranches.push({ repoPath, branch: ctx.identifier });
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
 * @see docs/ARCHITECTURE.md#in-review-lifecycle
 */
export async function awaitReplReady(session: string): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  let trustAccepted = false;
  let lastPane = "";
  while (Date.now() < deadline) {
    lastPane = await capturePane(session);
    if (READY.test(lastPane)) return;
    if (!trustAccepted && TRUST_DIALOG.test(lastPane)) {
      await sendKeys(session, ["Enter"]);
      trustAccepted = true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new StartStepError("starting claude", lastPane, "repl-timeout");
}

/**
 * Saga Step 3: launch the claude REPL in a detached tmux session. When the installed CLI meets
 * the hooks capability floor, the launch carries the dispatch settings layer (`--settings`) plus
 * the three per-session `DISPATCH_*` env vars via tmux `-e`; the token is minted and persisted
 * BEFORE the session exists because the kickoff paste fires the UserPromptSubmit hook (the
 * flip-back it triggers no-ops — the card is never in needs_input during the saga). Below floor
 * or under `statusChannel: "pane"` the launch is byte-identical to the pre-hooks argv (no
 * settings, no token, no env), and the pane watcher carries status alone; that branch first
 * resets the card's hook-channel state so a stale persisted latch/token from an earlier
 * hook-capable session can never survive into a hook-silent one.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
const startClaude: SagaStep = {
  name: "starting claude",
  statusText: "Starting Claude…",
  async run(ctx) {
    const session = "dsp-" + ctx.identifier;
    await preSeedTrust(ctx.workspacePath);
    await store.resetClaudeSessionId(ctx.card.id);

    const claudePath = (await resolveBinaryPath("claude")) ?? "claude";
    const runtime = getHooksRuntime();
    if (runtime?.capable && runtime.statusChannel !== "pane") {
      const previousToken = store.getCard(ctx.card.id)?.hookToken;
      const token = mintHookToken(ctx.card.id, previousToken);
      await store.setHookToken(ctx.card.id, token);
      await newSession(
        session,
        ctx.workspacePath,
        [
          claudePath,
          "--settings",
          HOOK_SETTINGS_PATH,
          "--dangerously-skip-permissions",
        ],
        {
          DISPATCH_HOOK_PORT: String(runtime.port),
          DISPATCH_HOOK_TOKEN: token,
          DISPATCH_CARD_ID: ctx.card.id,
        },
      );
    } else {
      await store.clearHookChannel(ctx.card.id);
      await newSession(session, ctx.workspacePath, [
        claudePath,
        "--dangerously-skip-permissions",
      ]);
    }
    ctx.tmuxSessionCreated = true;

    await awaitReplReady(session);
  },
  async undo(ctx) {
    if (ctx.tmuxSessionCreated) {
      await killSession("dsp-" + ctx.identifier).catch(() => {});
    }
  },
};

const sendKickoff: SagaStep = {
  name: "sending kickoff",
  statusText: "Sending kickoff…",
  async run(ctx) {
    const session = "dsp-" + ctx.identifier;
    const repoNames = (ctx.card.workspace?.repos ?? []).map((r) =>
      path.basename(r.path),
    );
    const kickoff = buildKickoff(ctx.card, ctx.extraDirection, repoNames, {
      restarted: ctx.restarted,
      playbookBody: ctx.playbookBody,
    });
    const tmpFile = path.join(
      os.tmpdir(),
      `dsp-kickoff-${ctx.identifier}-${Date.now()}.txt`,
    );
    await fsp.writeFile(tmpFile, kickoff, "utf8");
    try {
      await loadBuffer(session, tmpFile);
      await pasteBuffer(session, session);
      await sleep(PASTE_SETTLE_MS);
      await sendKeys(session, ["Enter"]);
    } finally {
      await fsp.unlink(tmpFile).catch(() => {});
    }
  },
  async undo() {},
};

/**
 * Paste an already-assembled follow-up prompt into the live `dsp-<identifier>` session using the
 * EXACT bracketed-paste-then-separate-Enter sequence sendKickoff uses (NEW-05/06), so the live
 * implementation handoff lands the same way the saga kickoff does. Owning the tmux paste here keeps
 * it inside services, so the /kickoff route never imports adapters (route→adapters boundary).
 */
export async function sendFollowupKickoff(
  identifier: string,
  body: string,
): Promise<void> {
  const session = "dsp-" + identifier;
  const tmpFile = path.join(
    os.tmpdir(),
    `dsp-followup-${identifier}-${Date.now()}.txt`,
  );
  await fsp.writeFile(tmpFile, body, "utf8");
  try {
    await loadBuffer(session, tmpFile);
    await pasteBuffer(session, session);
    await sleep(PASTE_SETTLE_MS);
    await sendKeys(session, ["Enter"]);
  } finally {
    await fsp.unlink(tmpFile).catch(() => {});
  }
}

/** The four steps, in forward execution order. */
export const steps: SagaStep[] = [
  prepareWorkspace,
  createWorktrees,
  startClaude,
  sendKickoff,
];
