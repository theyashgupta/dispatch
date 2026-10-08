import type { BoardKey, OrchestrationSummary } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { effectivePolicy } from "../domain/orchestrator-rules.js";
import { runningLoops, scopeTargetOf } from "./boards.js";
import { groupCost } from "./orchestrator-read.js";

/**
 * The dashboard summary of one board: the concurrency cap, the running loops and the cost of each group.
 *
 * @remarks A group card shows when it has loop progress or a session and is not in Done, and carries its identifier so the page needs no card lookup. The budget is the board budget narrowed by the owner orchestrator's override, as the supervisor budget stop does, and `ownerName` is set only when that override sets it.
 */
export function orchestrationSummary(board: BoardKey): OrchestrationSummary {
  const stored = store.getBoard(board);
  return {
    concurrencyCap: stored?.policy.concurrencyCap ?? null,
    runningLoops: runningLoops(board),
    groups: store
      .listCards(board)
      .filter(
        (card) =>
          card.source === "group" &&
          card.column !== "done" &&
          (card.loopProgress != null || (card.sessions?.length ?? 0) > 0),
      )
      .map((card) => {
        const owner = stored?.orchestrators.find(
          (r) => r.id === scopeTargetOf(card).owner,
        );
        const boardBudget = stored?.policy.budgetPerGroup ?? null;
        const budget = stored
          ? (effectivePolicy(stored.policy, owner).budgetPerGroup ?? null)
          : null;
        const override = owner !== undefined && budget !== boardBudget;
        return {
          cardId: card.id,
          groupId: card.identifier,
          cost: groupCost(card),
          budget,
          budgetSource: override ? ("override" as const) : ("board" as const),
          ownerName: override ? owner.name : null,
        };
      }),
  };
}
