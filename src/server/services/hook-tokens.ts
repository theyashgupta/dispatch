import { randomBytes } from "node:crypto";

/**
 * In-memory token→cardId registry for hook-POST auth. Rebuilt from persisted `card.hookToken`
 * after a backend restart (sessions deliberately outlive the process), so a reload never
 * silently orphans a live session's hooks. SECURITY: tokens are never logged and never ride
 * claude argv or the settings file — they reach the session exclusively via tmux `-e` env.
 */
const tokensByValue = new Map<string, string>();

/**
 * Mint a fresh 256-bit hex token for a card's new session and register it. Passing the card's
 * previous token removes the stale registry entry first (re-mint hygiene on restart/resume —
 * a dead session's secret must not keep resolving).
 */
export function mintHookToken(cardId: string, previousToken?: string): string {
  if (previousToken) tokensByValue.delete(previousToken);
  const token = randomBytes(32).toString("hex");
  tokensByValue.set(token, cardId);
  return token;
}

/**
 * Re-register a persisted token for a still-live session (reattach/reconcile paths), so an
 * in-memory map lost to a backend restart re-learns the session's existing secret.
 */
export function registerHookToken(token: string, cardId: string): void {
  tokensByValue.set(token, cardId);
}
