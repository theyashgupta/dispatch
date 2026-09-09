import type { Card } from "../../../shared/types.js";
import { DEFAULT_CLAUDE_ACCOUNT_ID } from "../../../shared/types.js";
import { store } from "../../store/board.store.js";
import {
  hasSession,
  paneAtPrompt,
  sessionEnvHas,
} from "../../adapters/tmux.js";
import { resolveLaunchAccount } from "../domain/claude-accounts.js";
import {
  awaitReplReady,
  buildLaunch,
  existingHooks,
  RESUME_MISSING,
  SHELL_SESSION_ENV,
  StartStepError,
  typeLaunchLine,
} from "./steps.js";

export type RunClaudeOutcome =
  "launched" | "busy" | "no-session" | "legacy" | "account";

const inFlight = new Set<string>();

/**
 * Relaunch claude inside a card's live shell session: the Run Claude button, and the same
 * command the person could type by hand with the right flags.
 *
 * @remarks Refuses with `busy` unless the pane's root shell owns the foreground and no start or
 * relaunch of the same card is in flight, because two overlapping `send-keys -l` interleave on
 * one shell line; refuses with `legacy` for a session created by an older build, whose pane root
 * is claude itself and would receive the line as prompt input. Resumes the conversation the hooks channel recorded (`--resume <id>`) and
 * otherwise starts a new one: `--continue` was measured to refuse even with a transcript on
 * disk for the cwd. A recorded id Claude refuses ("No conversation found", a session killed
 * before its transcript was flushed) is dropped, so the next click starts fresh instead of
 * failing forever. The built env is deliberately unused, since the shell already holds the
 * hook token and `CLAUDE_CONFIG_DIR` from session creation.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 */
export async function runClaude(cardId: string): Promise<RunClaudeOutcome> {
  const card = store.getCard(cardId);
  if (!card?.tmuxSession || !card.activeSessionId) return "no-session";
  if (inFlight.has(cardId) || store.isStarting(cardId)) return "busy";
  inFlight.add(cardId);
  try {
    return await relaunch(card, card.tmuxSession);
  } finally {
    inFlight.delete(cardId);
  }
}

async function relaunch(
  card: Card,
  tmuxSession: string,
): Promise<RunClaudeOutcome> {
  if (!(await hasSession(`=${tmuxSession}`))) return "no-session";
  if (!(await sessionEnvHas(`=${tmuxSession}`, SHELL_SESSION_ENV)))
    return "legacy";
  if (!(await paneAtPrompt(`=${tmuxSession}:`))) return "busy";

  const recorded = card.sessions?.find((s) => s.id === card.activeSessionId);
  const account = await resolveLaunchAccount(
    recorded?.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID,
  ).catch(() => null);
  if (account == null) return "account";

  const attempted = card.claudeSessionId;
  const { argv } = await buildLaunch(
    account,
    attempted ? ["--resume", attempted] : [],
    existingHooks(card),
  );
  await typeLaunchLine(tmuxSession, argv);
  void awaitReplReady(tmuxSession).catch(async (err: unknown) => {
    if (
      attempted !== undefined &&
      err instanceof StartStepError &&
      RESUME_MISSING.test(err.stderr)
    ) {
      await store.markClaudeSessionMissing(
        card.id,
        card.activeSessionId,
        attempted,
      );
      console.warn(
        `[run-claude] recorded conversation missing for card ${card.id}; the next relaunch falls back to the previous conversation`,
      );
      return;
    }
    console.warn(`[run-claude] claude did not reach READY for card ${card.id}`);
  });
  return "launched";
}
