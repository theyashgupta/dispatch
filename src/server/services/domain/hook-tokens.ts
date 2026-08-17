import { randomBytes } from "node:crypto";
import { store } from "../../store/board.store.js";

/**
 * In-memory token→{cardId, sessionId} registry for hook-POST auth. Rebuilt from persisted
 * `Session.hookToken` after a backend restart (sessions deliberately outlive the process), so a
 * reload never silently orphans a live session's hooks. Widened (Phase 91, HOOK-01) from a bare
 * cardId so a token minted for one session can never attribute an event to a sibling: the VALUE
 * carries the session identity the token was minted for, not just the card it belongs to.
 * SECURITY: tokens are never logged and never ride claude argv or the settings file — they reach
 * the session exclusively via tmux `-e` env.
 */
export interface HookTokenEntry {
  cardId: string;
  sessionId: string;
}

const tokensByValue = new Map<string, HookTokenEntry>();

/**
 * Generate a fresh 256-bit hex token VALUE only — registers nothing. Split out of the old
 * single-function mint-and-register shape (Phase 91) so the sequencing hazard it allowed becomes
 * structurally unrepresentable: a caller must first persist this value onto the session record
 * it will name (`store.mintHookChannel`, which mints the record when the card has none and
 * returns its id) and only THEN call {@link registerHookToken} against that real id. There is no
 * longer a code path that can register a token before the session it names exists.
 */
export function newHookTokenValue(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Register a token against the `{cardId, sessionId}` pair it authenticates for hook-POST auth.
 * Passing the card's previous token removes the stale registry entry first (re-mint hygiene on
 * restart/resume — a dead session's secret must not keep resolving).
 *
 * @remarks Refuses (logs, does not register) when `sessionId` does not name a record in the
 * resolved card's `sessions` array. A persisted token naming a session the card no longer owns —
 * a stale re-registration from boot reconcile, or a caller passing a foreign id — must never
 * resolve, because an orphan token that still resolved would land on the card's ACTIVE session:
 * exactly the cross-report bug this registry exists to prevent. Never throws (matches this
 * file's existing style of never throwing on a bad lookup) and never logs the token value, only
 * the card and session ids.
 */
export function registerHookToken(
  token: string,
  cardId: string,
  sessionId: string,
  previousToken?: string,
): void {
  if (previousToken) tokensByValue.delete(previousToken);
  const owned = store
    .getCard(cardId)
    ?.sessions?.some((s) => s.id === sessionId);
  if (!owned) {
    console.error(
      `[hooks] refusing session registration for card ${cardId} — session ${sessionId} not found`,
    );
    return;
  }
  tokensByValue.set(token, { cardId, sessionId });
}

/**
 * Drop a cleared token from the registry so a dead session's secret stops resolving. Wired into
 * the store at bootstrap as the hook-token releaser (the boundaries DAG forbids store → services),
 * which makes every session-clearing store mutation unregister at the moment it clears the field
 * — session lost, resume failure, and both cleanup outcomes included.
 */
export function unregisterHookToken(token: string): void {
  tokensByValue.delete(token);
}

/**
 * Resolve a presented token to its `{cardId, sessionId}` pair, or undefined for an unknown
 * token. The token IS the hook route's auth: card AND session identity derive exclusively from
 * this lookup, never from ids claimed in a request body — a body-claimed session id is never
 * trusted either, matching the existing card-identity policy. Never logs.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export function resolveHookToken(token: string): HookTokenEntry | undefined {
  return tokensByValue.get(token);
}
