import type { SessionTurnState } from "../../../shared/types.js";
import { capturePane } from "../../adapters/tmux.js";
import { parseLimitSurface } from "../domain/limit-surface.js";
import { getHooksRuntime } from "../infra/config-holder.js";

const BUSY_PANE = /esc to interrupt/;

const recorded = new Map<string, SessionTurnState>();

const keyOf = (cardId: string, sessionId: string): string =>
  `${cardId}:${sessionId}`;

/**
 * Record the turn state one hook event implies for a session; other events change nothing.
 *
 * @remarks A `StopFailure` for any error other than a rate limit still ends the turn, so it reads
 * as idle.
 */
export function recordTurnEvent(
  cardId: string,
  sessionId: string,
  event: unknown,
  error: unknown,
): void {
  let next: SessionTurnState | undefined;
  if (event === "UserPromptSubmit") next = "busy";
  else if (event === "Stop") next = "idle";
  else if (event === "StopFailure")
    next = error === "rate_limit" ? "limit" : "idle";
  if (next !== undefined) recorded.set(keyOf(cardId, sessionId), next);
}

/**
 * Read the state the hooks last recorded for a session; `unknown` before the first event since boot.
 */
export function recordedTurnState(
  cardId: string,
  sessionId: string,
): SessionTurnState {
  return recorded.get(keyOf(cardId, sessionId)) ?? "unknown";
}

/**
 * Drop a session's recorded state when its hook channel dies.
 */
export function forgetTurnState(
  cardId: string,
  sessionId: string | undefined,
): void {
  if (sessionId !== undefined) recorded.delete(keyOf(cardId, sessionId));
}

/** Read the turn state a Claude pane shows. */
export function paneTurnState(pane: string): SessionTurnState {
  if (BUSY_PANE.test(pane)) return "busy";
  if (parseLimitSurface(pane) !== null) return "limit";
  return "idle";
}

/** Combine the hook state with the pane check, where a busy or limit pane wins. */
export function resolveTurnState(
  hook: SessionTurnState,
  pane: string,
  paneOnly: boolean,
): SessionTurnState {
  const seen = paneTurnState(pane);
  if (paneOnly || hook === "unknown" || seen !== "idle") return seen;
  return hook;
}

/**
 * Resolve the turn state of a session whose pane runs Claude, given the pane text just captured.
 */
export function turnStateOf(
  cardId: string,
  sessionId: string,
  pane: string,
): SessionTurnState {
  return resolveTurnState(
    recordedTurnState(cardId, sessionId),
    pane,
    getHooksRuntime()?.statusChannel === "pane",
  );
}

/**
 * Read the turn state of a live session from a fresh pane capture; `unknown` when the capture fails.
 */
export async function liveTurnState(
  cardId: string,
  sessionId: string,
  tmuxSession: string,
): Promise<SessionTurnState> {
  try {
    return turnStateOf(
      cardId,
      sessionId,
      await capturePane(`=${tmuxSession}:`),
    );
  } catch {
    return "unknown";
  }
}
