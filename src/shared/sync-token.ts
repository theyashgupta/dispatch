/** The idempotency token a synced card's Linear issue carries as its last description line. */
export function syncToken(cardId: string): string {
  return `dispatch-sync:${cardId}`;
}

/**
 * Whether a description carries the token as a whole line.
 *
 * @remarks A substring test would let `dispatch-sync:LOCAL-1` match `dispatch-sync:LOCAL-12`.
 */
export function carriesSyncToken(
  description: string | null | undefined,
  token: string,
): boolean {
  return (description ?? "").split("\n").some((line) => line.trim() === token);
}

/**
 * Drop every Dispatch sync token line from a description before it goes out to Linear.
 *
 * @remarks A token line copied into another card would otherwise let that card's issue be adopted
 * by the card the token names.
 */
export function withoutSyncTokens(description: string): string {
  return description
    .split("\n")
    .filter((line) => !/^\s*dispatch-sync:\S+\s*$/.test(line))
    .join("\n")
    .trim();
}
