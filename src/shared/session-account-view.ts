import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type AccountSessionEntry,
  type ClaudeAccountSummary,
  type ContinueAction,
} from "./types.js";

export interface SessionAccountView {
  accountId: string;
  name: string;
  stale: boolean;
  continueAction?: ContinueAction;
  pendingNote?: string;
}

export interface SessionNote {
  tone: "error" | "info";
  text: string;
}

export type MoveSessionAccountResult =
  | { ok: true; outcome: "moved" | "same" | "queued" }
  | { ok: false; error: string; message: string };

export const MOVE_FAILED_NOTE: SessionNote = {
  tone: "error",
  text: "Couldn't move the session.",
};

/**
 * Name an account for display: "Default" for the home login, else its email.
 *
 * @remarks
 * An id missing from the list (a removed account) shows as the id itself so the row never blanks,
 * except the Default id, which reads "Default" even when the list has not loaded.
 */
export function accountName(
  accounts: readonly Pick<ClaudeAccountSummary, "id" | "email" | "isDefault">[],
  id: string,
): string {
  const account = accounts.find((a) => a.id === id);
  if (account?.isDefault === true) return "Default";
  if (account === undefined && id === DEFAULT_CLAUDE_ACCOUNT_ID) {
    return "Default";
  }
  return account?.email || id;
}

/** Say where a queued move sends the session, or that it restarts when the target is its own account. */
export function pendingNote(targetName: string, sameAccount: boolean): string {
  return sameAccount
    ? "Restarts after this turn"
    : `Moves to ${targetName} after this turn`;
}

export function moveNote(
  result: MoveSessionAccountResult,
  movedText: string,
): SessionNote {
  if (!result.ok) return { tone: "error", text: result.message };
  return {
    tone: "info",
    text: result.outcome === "queued" ? "Queued" : movedText,
  };
}

/**
 * Build what a session surface shows about its account: name, stale flag, continue action and
 * pending move.
 *
 * @remarks
 * The server sets `stale`, `continueAction` and `pendingAccountId` on the session entry, so this
 * only reads them. An added account has no view until the accounts list loads, so its id never
 * flashes as a name; the Default id reads "Default" at once.
 */
export function sessionAccountView(input: {
  sessionId: string | null | undefined;
  accountId: string | null | undefined;
  accounts: readonly ClaudeAccountSummary[] | undefined;
  sessions: readonly AccountSessionEntry[] | undefined;
}): SessionAccountView | null {
  const entry =
    input.sessionId == null
      ? undefined
      : input.sessions?.find((s) => s.sessionId === input.sessionId);
  const accountId = entry?.accountId ?? input.accountId;
  if (accountId == null) return null;
  if (input.accounts === undefined && accountId !== DEFAULT_CLAUDE_ACCOUNT_ID) {
    return null;
  }
  const accounts = input.accounts ?? [];
  const target = entry?.pendingAccountId;
  return {
    accountId,
    name: accountName(accounts, accountId),
    stale: entry?.stale === true,
    ...(entry?.continueAction !== undefined && {
      continueAction: entry.continueAction,
    }),
    ...(target !== undefined && {
      pendingNote: pendingNote(
        accountName(accounts, target),
        target === accountId,
      ),
    }),
  };
}
