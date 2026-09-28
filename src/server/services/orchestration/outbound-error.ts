export const OUTBOUND_COPY = {
  auth: "Linear rejected the API key. Check it in Settings.",
  rateLimited: "Linear is rate limiting requests. Try again in a minute.",
  unreachable: "Could not reach Linear. Try again.",
} as const;

/**
 * Map a failed Linear write to fixed card copy, so raw provider text never reaches a card.
 *
 * @remarks Classifies by error name because services may not import `sources`, where both error
 * classes live.
 */
export function outboundErrorCopy(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "LinearAuthError") return OUTBOUND_COPY.auth;
  if (name === "RateLimited") return OUTBOUND_COPY.rateLimited;
  return OUTBOUND_COPY.unreachable;
}
