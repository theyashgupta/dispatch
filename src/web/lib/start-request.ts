/**
 * Start-flow request shape shared by Board and App; lives in lib so
 * consumers never type-import across feature files.
 */
export interface StartRequest {
  cardId: string;
  /**
   * Set when the request means "start an ADDITIONAL session on a card that already has one" —
   * an intent, never an instruction. It gates the server's reattach early-return and is
   * re-validated server-side against the card's own `activeSessionId` (409 when there is nothing
   * to start another from).
   */
  newSession?: boolean;
}
