import type { Card, Column } from "../../../../shared/types.js";

const RECOVERY_HIDDEN_COLUMNS: ReadonlySet<Column> = new Set([
  "in_review",
  "parked",
  "done",
]);

/**
 * Whether the card face shows the lost-session UI: the Lost chip, the Session lost notice, Resume and Restart.
 *
 * @remarks
 * Cards in In Review, Parked and Done are past the agent stage, so a lost session there is not a fault.
 * The detail panel still offers Resume for these cards.
 */
export function showsSessionRecovery(card: Pick<Card, "column">): boolean {
  return !RECOVERY_HIDDEN_COLUMNS.has(card.column);
}
