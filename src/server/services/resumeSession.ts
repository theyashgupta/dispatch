import { store } from "../store/board.store.js";
import { hasSession, killSession, newSession } from "../adapters/tmux.js";
import { preSeedTrust } from "../adapters/claude-trust.js";
import { resolveBinaryPath } from "../adapters/resolve-binary.js";
import { awaitReplReady, StartStepError } from "./steps.js";
import { REATTACH_STATUS_CLEAR_MS } from "./startSession.js";
import { ensureTerminal } from "./terminal.js";

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
 * mutation, so the panel re-enables Resume and renders the spec'd error copy. SECURITY: errors
 * are logged content-free — no stderr or pane text leaks (the pane payload rides
 * StartStepError.message, so only the step name may be logged).
 * @see docs/ARCHITECTURE.md#in-review-lifecycle
 */
export async function resumeSession(cardId: string): Promise<void> {
  if (store.isStarting(cardId)) return;
  store.beginStart(cardId);
  try {
    const card = store.getCard(cardId);
    if (!card?.workspacePath) return;
    await store.clearResumeError(cardId);
    const session = "dsp-" + card.identifier;

    if (await hasSession(`=${session}`)) {
      await store.resumeSession(cardId, { session });
      setTimeout(
        () => void store.setStatusReason(cardId, null),
        REATTACH_STATUS_CLEAR_MS,
      );
      await ensureTerminal(cardId, session);
      return;
    }

    await preSeedTrust(card.workspacePath);
    const claudePath = (await resolveBinaryPath("claude")) ?? "claude";
    await newSession(session, card.workspacePath, [
      claudePath,
      "--continue",
      "--dangerously-skip-permissions",
    ]);
    await awaitReplReady(session);
    await store.resumeSession(cardId, { session });
    setTimeout(
      () => void store.setStatusReason(cardId, null),
      REATTACH_STATUS_CLEAR_MS,
    );
    await ensureTerminal(cardId, session);
  } catch (err) {
    const card = store.getCard(cardId);
    if (card) await killSession(`=dsp-${card.identifier}`);
    await store.recordResumeFailure(cardId);
    const step = err instanceof StartStepError ? err.step : "unknown step";
    console.error(`[resume] failed for card ${cardId} (${step})`);
  } finally {
    store.endStart(cardId);
  }
}
