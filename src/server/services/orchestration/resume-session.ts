import { store } from "../store/board.store.js";
import { hasSession, killSession, newSession } from "../adapters/tmux.js";
import { preSeedTrust } from "../adapters/claude-trust.js";
import { resolveBinaryPath } from "../adapters/resolve-binary.js";
import { awaitReplReady, StartStepError } from "./steps.js";
import { getHooksRuntime } from "./infra/config-holder.js";
import { mintHookToken, registerHookToken } from "./domain/hook-tokens.js";
import { HOOK_SETTINGS_PATH } from "./infra/paths.js";
import { REATTACH_STATUS_CLEAR_MS } from "./start-session.js";
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
 * mutation, so the panel re-enables Resume and renders the spec'd error copy. Hook injection
 * mirrors the start saga: a relaunch on a hooks-capable CLI mints a FRESH token (new session =
 * new token, persisted before the session exists) and carries `--settings` plus the three
 * `DISPATCH_*` env vars; a reattach re-registers the card's persisted token so an in-memory
 * registry lost to a backend restart re-learns the live session's secret; below the capability
 * floor or under `statusChannel: "pane"` the relaunch argv is byte-identical to the pre-hooks
 * shape, and that branch first resets the card's hook-channel state so a stale persisted
 * latch/token from an earlier hook-capable session can never survive into a hook-silent one.
 * SECURITY: errors
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
    const resumeArgs = card.claudeSessionId
      ? ["--resume", card.claudeSessionId]
      : ["--continue"];

    if (await hasSession(`=${session}`)) {
      if (card.hookToken) registerHookToken(card.hookToken, cardId);
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
    const runtime = getHooksRuntime();
    if (runtime?.capable && runtime.statusChannel !== "pane") {
      const token = mintHookToken(cardId, card.hookToken);
      await store.setHookToken(cardId, token);
      await newSession(
        session,
        card.workspacePath,
        [
          claudePath,
          ...resumeArgs,
          "--settings",
          HOOK_SETTINGS_PATH,
          "--dangerously-skip-permissions",
        ],
        {
          DISPATCH_HOOK_PORT: String(runtime.port),
          DISPATCH_HOOK_TOKEN: token,
          DISPATCH_CARD_ID: cardId,
        },
      );
    } else {
      await store.clearHookChannel(cardId);
      await newSession(session, card.workspacePath, [
        claudePath,
        ...resumeArgs,
        "--dangerously-skip-permissions",
      ]);
    }
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
