import type { Card } from "../../../../shared/types.js";

export type SessionFlowStageId = "item" | "agent" | "terminal" | "result";
export type SessionFlowState =
  "idle" | "working" | "waiting" | "done" | "lost" | "failed";

type SessionFlowCard = Pick<
  Card,
  "column" | "tmuxSession" | "sessionLost" | "provisioningStep" | "startError"
>;

/**
 * Where a card's session sits on the item, agent, terminal, result row, and in what state.
 *
 * @remarks Start errors, provisioning and a lost session are read before the column, so a lost
 * session never reads as working whatever column it was left in.
 */
export function sessionFlowStage(card: SessionFlowCard): {
  stage: SessionFlowStageId;
  state: SessionFlowState;
} {
  if (card.startError) return { stage: "agent", state: "failed" };
  if (card.provisioningStep) return { stage: "agent", state: "working" };
  if (card.sessionLost) return { stage: "terminal", state: "lost" };
  switch (card.column) {
    case "in_progress":
      return card.tmuxSession
        ? { stage: "terminal", state: "working" }
        : { stage: "item", state: "idle" };
    case "needs_input":
      return { stage: "terminal", state: "waiting" };
    case "agent_done":
    case "in_review":
    case "done":
      return { stage: "result", state: "done" };
    case "parked":
      return { stage: "terminal", state: "idle" };
    default:
      return { stage: "item", state: "idle" };
  }
}

/** Whether the panel shows the session row: the card has a session or a start attempt. */
export function hasSessionFlow(
  card: Pick<
    Card,
    "activeSessionId" | "tmuxSession" | "provisioningStep" | "startError"
  >,
): boolean {
  return Boolean(
    card.activeSessionId ||
    card.tmuxSession ||
    card.provisioningStep ||
    card.startError,
  );
}
