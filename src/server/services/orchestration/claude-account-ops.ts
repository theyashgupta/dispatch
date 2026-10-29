import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type AccountSessionEntry,
  type ChainView,
  type ClaudeAccountSummary,
} from "../../../shared/types.js";
import {
  logoutClaudeConfigDir,
  readClaudeIdentity,
  type ClaudeIdentity,
} from "../../adapters/claude-cli.js";
import { getClaudeAccountsSettings } from "../infra/config-holder.js";
import { continueActionFor } from "../domain/limit-surface.js";
import {
  accountDir,
  canonicalAccountId,
  isExternalAccountDir,
  getActiveAccountId,
  getManagedDefaultId,
  listAccounts,
  readChainOrder,
  readRegistry,
  removeAccount,
} from "./claude-accounts.js";
import { expireLimit } from "../domain/account-state.js";
import { readChainState } from "./account-chain-state.js";
import { forgetChainAccount } from "./account-chain.js";
import { forgetUsage, getUsage, usageBuckets } from "./claude-usage.js";
import { liveTurnState } from "./session-turn.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ALL_BOARDS } from "../../../shared/board-key.js";

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
 * List every account in chain order with its usage snapshot and chain fields for `GET /accounts`.
 *
 * @remarks `state`, `buckets` and `limitedUntil` come from the chain state file; an account the
 * controller has not read yet is `unknown` with the buckets of its usage snapshot. A stored
 * `limited` state whose `limitedUntil` passed reads `unknown` with no `limitedUntil`.
 */
export async function listAccountSummaries(): Promise<ClaudeAccountSummary[]> {
  const [accounts, order, chain] = await Promise.all([
    homeIdentity().then(listAccounts),
    readChainOrder(),
    readChainState(),
  ]);
  const activeId = getActiveAccountId();
  return accounts
    .map((a) => {
      const usage = getUsage(a.id);
      const entry = chain.accounts[a.id];
      const stored = expireLimit(
        {
          state: entry?.state ?? "unknown",
          limitedUntil: entry?.limitedUntil ?? null,
        },
        new Date(),
      );
      return {
        ...a,
        usage,
        position: order.indexOf(a.id),
        ...stored,
        buckets: entry?.buckets ?? usageBuckets(usage),
        inUse: a.id === activeId,
      } satisfies ClaudeAccountSummary;
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * Return the code that refuses a manual switch to an account, or null when the switch may go ahead.
 *
 * @remarks
 * It reads the same chain state file as the account listing, so the page and the guard agree. The
 * canonical id makes `default` resolve to the managed default.
 */
export async function manualSwitchRefusal(
  id: string,
): Promise<"account-needs-login" | "account-shadowed-by-home" | null> {
  const state = (await readChainState()).accounts[canonicalAccountId(id)]
    ?.state;
  if (state === "needs-login") return "account-needs-login";
  if (state === "shadowed-by-home") return "account-shadowed-by-home";
  return null;
}

/**
 * Return the chain settings, exhausted record and history for `GET /api/accounts`, newest move first.
 */
export async function readChainView(): Promise<ChainView> {
  const chain = await readChainState();
  return {
    settings: getClaudeAccountsSettings(),
    exhausted: chain.exhausted,
    history: [...chain.moves].reverse(),
    inUseSince: chain.inUseSince,
  };
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
    store.sessionsWithTmux(ALL_BOARDS).map(async ({ card, session }) => {
      const accountId = canonicalAccountId(session.claudeAccountId);
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
        pinned: session.accountPinned === true,
        ...(session.pendingClaudeAccountId !== undefined
          ? { pendingAccountId: session.pendingClaudeAccountId }
          : {}),
        ...(continueAction !== undefined ? { continueAction } : {}),
      };
    }),
  );
}

/**
 * True when Default can be offered a managed login: none exists and the home login is not held by a record.
 */
export async function managedDefaultOffered(): Promise<boolean> {
  if (getManagedDefaultId() !== undefined) return false;
  const home = await homeIdentity();
  if (!home.loggedIn) return false;
  return !(await readRegistry()).some(
    (a) =>
      a.email === home.email &&
      (!a.orgId || !home.orgId || a.orgId === home.orgId),
  );
}

/**
 * Remove an added account with its dir, registry record, cached usage, queued moves and chain entry.
 *
 * @remarks The dir is signed out first so Claude Code deletes its own keychain item. Removing the
 * managed default first retags its sessions to `default`, which is the home login again.
 */
export async function removeAccountAndLogout(
  id: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  const known = (await readRegistry()).some((a) => a.id === id);
  if (!known || isExternalAccountDir(id))
    return { ok: false, error: "not-found" };
  if (id === getManagedDefaultId()) {
    for (const card of store.listCards(ALL_BOARDS)) {
      for (const session of card.sessions ?? []) {
        if (session.claudeAccountId === id) {
          await store.setSessionAccount(
            card.id,
            session.id,
            DEFAULT_CLAUDE_ACCOUNT_ID,
          );
        }
      }
    }
  }
  await logoutClaudeConfigDir(accountDir(id));
  const result = await removeAccount(id);
  if (result.ok) {
    forgetUsage(id);
    await store.clearPendingAccountsFor(id);
    await forgetChainAccount(id);
  }
  return result;
}
