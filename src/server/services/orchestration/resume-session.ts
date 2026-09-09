import path from "node:path";
import { DEFAULT_CLAUDE_ACCOUNT_ID } from "../../../shared/types.js";
import { store } from "../../store/board.store.js";
import { hasSession, killSession } from "../../adapters/tmux.js";
import { resolveLaunchAccount } from "../domain/claude-accounts.js";
import { launchClaude, RESUME_MISSING, StartStepError } from "./steps.js";
import { registerHookToken } from "../domain/hook-tokens.js";
import { REATTACH_STATUS_CLEAR_MS } from "./start-session.js";
import { ensureTerminal } from "./terminal.js";

const ACCOUNT_STEP = "resolving Claude account";

/**
 * Reconnect a card's terminal, relaunching the session when its tmux pane is gone.
 *
 * @remarks `ensureTerminal` can only respawn ttyd. When the pane itself has vanished (tmux server
 * killed, reboot) the session is marked lost and the resume saga relaunches `claude --resume` in
 * the same worktree, so one Reconnect click recovers instead of dead-ending.
 */
export async function reconnectTerminal(cardId: string): Promise<void> {
  const card = store.getCard(cardId);
  if (!card?.tmuxSession || !card.activeSessionId) return;
  if (await hasSession(`=${card.tmuxSession}`)) {
    await ensureTerminal(cardId, card.activeSessionId, card.tmuxSession);
    return;
  }
  if (store.isCleaningUp(cardId)) return;
  await store.markSessionLost(cardId, card.activeSessionId);
  await resumeSession(cardId);
}

/**
 * Column-preserving Resume for a dead In Review session (REV-04): relaunch `claude --continue` in
 * the surviving `card.workspacePath` cwd and reattach its terminal, WITHOUT re-sending a kickoff
 * prompt and WITHOUT ever writing the card's column. Deliberately NOT the start saga — that path
 * forces the card to `in_progress` and injects a fresh kickoff, both of which would break the
 * "same conversation, same In Review column" contract. Reuses the start primitives (trust
 * pre-seed, binary resolve, session spawn, readiness poll) minus the kickoff. The one-saga-per-card
 * guard (CR-01) is shared with Start so Resume can never race it. On an already-live session it
 * idempotently re-adopts. Fire-and-forget from the route (202 already sent); all state reaches the
 * UI via the store's SSE broadcast. On failure the partial tmux is torn down and
 * `recordResumeFailure` restores `sessionLost` plus the failure notice in one SSE-visible
 * mutation, so the panel re-enables Resume and renders the spec'd error copy. Hook injection
 * mirrors the start saga: a relaunch on a hooks-capable CLI mints a FRESH token (persisted before
 * the session exists) and carries `--settings` plus the three `DISPATCH_*` env vars, while the
 * `hookRoutedAt` routing latch stays unstamped until a hook POST actually authenticates
 * (`WR-05`) — a resumed session sends no kickoff, so it may sit idle for a long time, and
 * predicting the latch would strand it with no status channel at all; a reattach re-registers the
 * card's persisted token so an in-memory
 * registry lost to a backend restart re-learns the live session's secret; below the capability
 * floor or under `statusChannel: "pane"` the relaunch argv is byte-identical to the pre-hooks
 * shape, and that branch first resets the card's hook-channel state so a stale persisted
 * latch/token from an earlier hook-capable session can never survive into a hook-silent one.
 * SECURITY: errors
 * are logged content-free — no stderr or pane text leaks (the pane payload rides
 * StartStepError.message, so only the step name may be logged).
 * @remarks (Phase 91) Both reattach paths — the already-live-tmux-session branch above and
 * `start-session.ts`'s own reattach — register the card's persisted token against
 * `card.activeSessionId` because a reattach always targets the card's ACTIVE session by
 * construction; neither path can ever reattach onto a sibling. The fresh-mint branch closes the
 * token-before-session sequencing hazard structurally, mirroring `steps.ts#startClaude`:
 * `store.mintHookChannel` persists the token AND reports which session it landed on, and only
 * then is the token registered against that real id — a `mintHookChannel` reporting no session
 * (unknown card id, or one whose active pointer names no record) skips registration and falls
 * through to the hook-silent launch.
 * @remarks (`WR-01`) The stale token is SNAPSHOTTED before the mint, matching `steps.ts`'s own
 * ordering. `store.getCard` returns the live Map entry, so `mintHookChannel` overwrites
 * `card.hookToken` in place: reading it after the mint would hand `registerHookToken` the token it
 * is about to register, degenerating re-mint hygiene into `delete(token)` then `set(token)` and
 * leaving the genuinely stale credential resolving forever.
 * @remarks (LOCAL-13) The resume id is the session's `claudeSessionId` mirror, the newest
 * conversation node by activity. A "No conversation found" refusal stamps THAT node missing via
 * `store.markClaudeSessionMissing`, so the next Resume falls back to the previous node on the same
 * branch and only reaches `--continue` when none is left.
 * @remarks (LOCAL-2) Resume targets the ACTIVE session record, whatever its ordinal: the tmux
 * name derives from that record's own `branch` (fallback: the workspacePath basename, identical
 * for every generation of card), NEVER from `card.identifier`, which is only session 1's name and
 * would cross-wire a sub-session's resume onto the primary's tmux. The failure-path kill targets
 * the SAME derived name, and every store write carries the session id captured at saga entry, so
 * a mid-resume active-pointer switch can neither kill a live sibling nor stamp the resumed tmux
 * onto the wrong record.
 * @see docs/ARCHITECTURE.md#in-review-lifecycle
 */
export async function resumeSession(cardId: string): Promise<void> {
  if (store.isStarting(cardId)) return;
  store.beginStart(cardId);
  let killTarget: string | null = null;
  let sessionId: string | undefined;
  let attempted: string | undefined;
  try {
    const card = store.getCard(cardId);
    if (!card?.workspacePath || !card.activeSessionId) return;
    sessionId = card.activeSessionId;
    await store.clearResumeError(cardId);
    const active = card.sessions?.find((s) => s.id === sessionId);
    const session =
      "dsp-" + (active?.branch ?? path.basename(card.workspacePath));
    killTarget = session;
    attempted = card.claudeSessionId;
    const resumeArgs = attempted ? ["--resume", attempted] : ["--continue"];

    if (await hasSession(`=${session}`)) {
      if (card.hookToken && card.activeSessionId) {
        registerHookToken(card.hookToken, cardId, card.activeSessionId);
      }
      await store.resumeSession(cardId, { session }, sessionId);
      setTimeout(
        () => void store.setStatusReason(cardId, null),
        REATTACH_STATUS_CLEAR_MS,
      );
      await ensureTerminal(cardId, sessionId, session);
      return;
    }

    const recorded = card.sessions?.find((s) => s.id === sessionId);
    const account = await resolveLaunchAccount(
      recorded?.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID,
    ).catch((err: unknown) => {
      throw new StartStepError(
        ACCOUNT_STEP,
        err instanceof Error ? err.message : String(err),
        "config",
      );
    });
    killTarget = null;
    await launchClaude({
      cardId,
      sessionId,
      tmuxSession: session,
      cwd: card.workspacePath,
      leadingArgs: resumeArgs,
      account,
      onCreated: () => {
        killTarget = session;
      },
    });
    await store.resumeSession(cardId, { session }, sessionId);
    setTimeout(
      () => void store.setStatusReason(cardId, null),
      REATTACH_STATUS_CLEAR_MS,
    );
    await ensureTerminal(cardId, sessionId, session);
  } catch (err) {
    if (killTarget != null) await killSession(`=${killTarget}`);
    if (
      attempted !== undefined &&
      err instanceof StartStepError &&
      RESUME_MISSING.test(err.stderr)
    ) {
      await store.markClaudeSessionMissing(cardId, sessionId, attempted);
    }
    const step = err instanceof StartStepError ? err.step : "unknown step";
    await store.recordResumeFailure(
      cardId,
      sessionId,
      err instanceof StartStepError && err.step === ACCOUNT_STEP
        ? err.stderr
        : undefined,
    );
    console.error(`[resume] failed for card ${cardId} (${step})`);
  } finally {
    store.endStart(cardId);
  }
}
