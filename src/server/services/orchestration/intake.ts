import type { Board } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError } from "../domain/errors.js";
import { mainOrchestrator } from "../domain/orchestrator-rules.js";

/**
 * Hand a goal and optional pasted requirements to the main orchestrator of a board.
 *
 * @remarks
 * Creates no ticket. The orchestrator answers with a `ticket_proposal` decision item, and
 * tickets follow only from an approved proposal.
 * @returns The id of the appended event.
 */
export function submitIntake(
  board: Board,
  input: { goal: string; requirements?: string | undefined },
): number {
  const main = mainOrchestrator(board.orchestrators);
  if (!main) throw new ConflictError("no-main-orchestrator");
  return store.appendOrchestrationEvent({
    boardKey: board.key,
    cardId: null,
    sessionId: null,
    kind: "intake_submitted",
    data: {
      orchestratorId: main.id,
      goal: input.goal,
      requirements: input.requirements ?? null,
    },
    ts: new Date().toISOString(),
  }).id;
}
