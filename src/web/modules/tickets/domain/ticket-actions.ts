import type { Card } from "../../../../shared/types.js";
import { isWebUrl } from "../../../../shared/web-url.js";

export type TicketActionId = "start" | "done" | "open";

/**
 * Pick which row actions apply to a Linear ticket card.
 *
 * @remarks The rules mirror the server guards on the move route, so a row never offers an action
 * that answers 409: an Inbox card can only be promoted, a grouped member moves with its group, and
 * a card mid-start belongs to the start saga until it settles.
 */
export function ticketActionsFor(
  card: Pick<Card, "column" | "url" | "groupId" | "provisioningStep">,
): TicketActionId[] {
  const actions: TicketActionId[] = [];
  const movable = card.groupId == null && card.provisioningStep == null;
  if (movable && card.column === "todo") actions.push("start");
  if (
    movable &&
    card.column !== "inbox" &&
    card.column !== "done" &&
    card.column !== "agent_done"
  ) {
    actions.push("done");
  }
  if (isWebUrl(card.url)) actions.push("open");
  return actions;
}
