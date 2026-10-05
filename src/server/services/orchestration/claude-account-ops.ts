import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type AccountSessionEntry,
  type ClaudeAccountSummary,
} from "../../../shared/types.js";
import {
  logoutClaudeConfigDir,
  readClaudeIdentity,
  type ClaudeIdentity,
} from "../../adapters/claude-cli.js";
import { continueActionFor } from "../domain/limit-surface.js";
import {
  accountDir,
  getActiveAccountId,
  listAccounts,
  readRegistry,
  removeAccount,
} from "./claude-accounts.js";
import { forgetUsage, getUsage } from "./claude-usage.js";
import { liveTurnState } from "./session-turn.js";
import { boardRepository as store } from "../../store/board-repository.js";

const IDENTITY_TTL_MS = 5 * 60 * 1000;

let homeIdentityCache: { at: number; identity: ClaudeIdentity } | null = null;

/**
 * The home login's identity, cached for five minutes because every read spawns the CLI.
 */
export async function homeIdentity(): Promise<ClaudeIdentity> {
  if (
    homeIdentityCache &&
    Date.now() - homeIdentityCache.at < IDENTITY_TTL_MS
  ) {
    return homeIdentityCache.identity;
  }
  const identity = await readClaudeIdentity();
  homeIdentityCache = { at: Date.now(), identity };
  return identity;
}

/**
 * Replace the cached home identity with a fresh read, so the next listing shows it at once.
 */
export function cacheHomeIdentity(identity: ClaudeIdentity): void {
  homeIdentityCache = { at: Date.now(), identity };
}

/**
 * Every account with its cached usage snapshot, the shape `GET /api/accounts` returns.
 */
export async function listAccountSummaries(): Promise<ClaudeAccountSummary[]> {
  const accounts = await listAccounts(await homeIdentity());
  return accounts.map((a) => ({ ...a, usage: getUsage(a.id) }));
}

/**
 * List one entry per live session on every card.
 *
 * @remarks An entry carries the account, a fresh turn state, the stale flag, the queued account and
 * the continue action; a session with no tmux session is lost and not listed. The continue action
 * is offered only when the session runs on another account than the
 * active one and the active account has allowance (U1-11).
 */
export async function listAccountSessions(): Promise<AccountSessionEntry[]> {
  const activeId = getActiveAccountId();
  return Promise.all(
    store.sessionsWithTmux().map(async ({ card, session }) => {
      const accountId = session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID;
      const turn = await liveTurnState(
        card.id,
        session.id,
        session.tmuxSession,
      );
      const continueAction =
        turn === "limit" && accountId !== activeId
          ? continueActionFor(getUsage(activeId))
          : undefined;
      return {
        cardId: card.id,
        sessionId: session.id,
        cardTitle: card.title,
        accountId,
        turn,
        stale: session.claudeAccountStale === true,
        ...(session.pendingClaudeAccountId !== undefined
          ? { pendingAccountId: session.pendingClaudeAccountId }
          : {}),
        ...(continueAction !== undefined ? { continueAction } : {}),
      };
    }),
  );
}

/**
 * Remove an added account along with its dir, registry record, cached usage and queued moves.
 *
 * @remarks The dir is signed out first so Claude Code deletes its own keychain item.
 */
export async function removeAccountAndLogout(
  id: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  const known = (await readRegistry()).some((a) => a.id === id);
  if (!known) return { ok: false, error: "not-found" };
  await logoutClaudeConfigDir(accountDir(id));
  const result = await removeAccount(id);
  if (result.ok) {
    forgetUsage(id);
    await store.clearPendingAccountsFor(id);
  }
  return result;
}
