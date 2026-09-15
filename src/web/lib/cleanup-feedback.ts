import type { Card } from "../../shared/types.js";

/** Toast copy for a manual cleanup whose POST never reached the server or was refused. */
export function cleanupRequestFailedCopy(identifier: string): string {
  return `Couldn't clean up ${identifier}. Try again.`;
}

/**
 * True once a manual cleanup attempt tracked from `attempt` has fully ended on the server.
 * @remarks Two signals are needed (LOCAL-18): `cleanupAttempt` proves a terminal outcome was
 * recorded (a stale frame before `cleaningUp` is even set would otherwise read as finished), and
 * `cleaningUp` off proves the whole multi-session fan-out ended, not just its first session.
 */
export function cleanupAttemptEnded(
  card: Card,
  attempt: number | undefined,
): boolean {
  return card.cleaningUp !== true && card.cleanupAttempt !== attempt;
}

/**
 * Toast copy for a cleanup that ended without tearing the workspace down, or null for a quiet
 * finish that needs no toast.
 * @remarks Reads the same fields `CardView` renders so the toast and the card notice agree; a
 * blocked session wins over a warning because the modal offers the discard path for it.
 */
export function cleanupOutcomeCopy(card: Card): string | null {
  const blocked =
    card.sessionSummaries == null
      ? (card.cleanupBlocked?.length ?? 0) > 0
      : card.sessionSummaries.some((s) => (s.cleanupBlocked?.length ?? 0) > 0);
  if (blocked) {
    return `${card.identifier}: cleanup blocked by uncommitted work. Open the ticket to discard and clean up.`;
  }
  if (card.cleanupWarning != null && card.cleanupWarning.trim() !== "") {
    return `${card.identifier}: ${card.cleanupWarning}`;
  }
  return null;
}
