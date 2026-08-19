import { DEFAULT_CLAUDE_ARGS } from "../../../shared/types.js";
import { store } from "../../store/board.store.js";
import { hasSession, killSession, newSession } from "../../adapters/tmux.js";
import { preSeedTrust } from "../../adapters/claude-trust.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";
import { awaitReplReady, StartStepError } from "./steps.js";
import { parseClaudeArgs } from "../domain/claude-args.js";
import {
  getHooksRuntime,
  getOrchestrationConfig,
} from "../infra/config-holder.js";
import { newHookTokenValue, registerHookToken } from "../domain/hook-tokens.js";
import { HOOK_SETTINGS_PATH } from "../infra/paths.js";
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
 * @see docs/ARCHITECTURE.md#in-review-lifecycle
 */
export async function resumeSession(cardId: string): Promise<void> {
  if (store.isStarting(cardId)) return;
  store.beginStart(cardId);
  try {
    const card = store.getCard(cardId);
    if (!card?.workspacePath || !card.activeSessionId) return;
    const sessionId = card.activeSessionId;
    await store.clearResumeError(cardId);
    const session = "dsp-" + card.identifier;
    const resumeArgs = card.claudeSessionId
      ? ["--resume", card.claudeSessionId]
      : ["--continue"];

    if (await hasSession(`=${session}`)) {
      if (card.hookToken && card.activeSessionId) {
        registerHookToken(card.hookToken, cardId, card.activeSessionId);
      }
      await store.resumeSession(cardId, { session });
      setTimeout(
        () => void store.setStatusReason(cardId, null),
        REATTACH_STATUS_CLEAR_MS,
      );
      await ensureTerminal(cardId, sessionId, session);
      return;
    }

    await preSeedTrust(card.workspacePath);
    const claudePath = (await resolveBinaryPath("claude")) ?? "claude";
    const claudeArgs = parseClaudeArgs(
      getOrchestrationConfig()?.claudeArgs ?? DEFAULT_CLAUDE_ARGS,
    );
    const runtime = getHooksRuntime();
    let launchedHooksCapable = false;
    if (runtime?.capable && runtime.statusChannel !== "pane") {
      const previousToken = card.hookToken;
      const token = newHookTokenValue();
      const mintedSessionId = await store.mintHookChannel(cardId, token);
      if (mintedSessionId !== undefined) {
        registerHookToken(token, cardId, mintedSessionId, previousToken);
        await newSession(
          session,
          card.workspacePath,
          [
            claudePath,
            ...resumeArgs,
            "--settings",
            HOOK_SETTINGS_PATH,
            ...claudeArgs,
          ],
          {
            DISPATCH_HOOK_PORT: String(runtime.port),
            DISPATCH_HOOK_TOKEN: token,
            DISPATCH_CARD_ID: cardId,
          },
        );
        launchedHooksCapable = true;
      }
    }
    if (!launchedHooksCapable) {
      await store.clearHookChannel(cardId);
      await newSession(session, card.workspacePath, [
        claudePath,
        ...resumeArgs,
        ...claudeArgs,
      ]);
    }
    await awaitReplReady(session);
    await store.resumeSession(cardId, { session });
    setTimeout(
      () => void store.setStatusReason(cardId, null),
      REATTACH_STATUS_CLEAR_MS,
    );
    await ensureTerminal(cardId, sessionId, session);
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
