import type { Board } from "../../../../shared/types.js";

export interface EntryModel {
  hasOrchestrator: boolean;
  label: "Add orchestrator" | "Orchestrator";
  tooltip: string | null;
}

export const ADD_TOOLTIP =
  "Add an orchestrator to plan tickets and run loops on this board.";

/**
 * Decide the header entry button of a board from its record, or null before the board loads.
 *
 * @remarks
 * Reads only the `Board` that the board list already holds, so a board with no
 * orchestrator costs no extra request.
 */
export function entryModel(
  board: Pick<Board, "orchestrators"> | null,
): EntryModel | null {
  if (board === null) return null;
  const hasOrchestrator = board.orchestrators.length > 0;
  return hasOrchestrator
    ? {
        hasOrchestrator,
        label: "Orchestrator",
        tooltip: null,
      }
    : {
        hasOrchestrator,
        label: "Add orchestrator",
        tooltip: ADD_TOOLTIP,
      };
}
