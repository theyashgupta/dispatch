import type {
  ClaudeAccountSummary,
  SessionTurnState,
} from "../../../../shared/types.js";

const TURN_LABELS: Record<SessionTurnState, string> = {
  idle: "Idle",
  busy: "Working",
  limit: "At usage limit",
  unknown: "Unknown",
};

/** Name a turn state in words for a session row. */
export function turnLabel(turn: SessionTurnState): string {
  return TURN_LABELS[turn];
}

/**
 * Name an account for a session row: "Default" for the home login, else its email.
 *
 * @remarks
 * An id missing from the list (a removed account) shows as the id itself so the row never blanks.
 */
export function accountName(
  accounts: readonly Pick<ClaudeAccountSummary, "id" | "email" | "isDefault">[],
  id: string,
): string {
  const account = accounts.find((a) => a.id === id);
  if (account?.isDefault === true) return "Default";
  return account?.email || id;
}

/** Say where a queued move sends the session, or that it restarts when the target is its own account. */
export function pendingNote(targetName: string, sameAccount: boolean): string {
  return sameAccount
    ? "Restarts after this turn"
    : `Moves to ${targetName} after this turn`;
}
