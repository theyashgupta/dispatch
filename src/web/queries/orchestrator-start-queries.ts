import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import { boardListKeys } from "./board-list-queries.js";
import { startMainOrchestrator } from "./orchestrator-start-api.js";

/**
 * Build the mutation options that start the main orchestrator of a board.
 *
 * @remarks The board list refreshes after the call settles, so the palette sees the new record and state.
 */
export function startOrchestratorMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: { board: BoardKey; hasMainRecord: boolean }) =>
      startMainOrchestrator(vars.board, vars.hasMainRecord),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: boardListKeys.list });
    },
  };
}

export function useStartOrchestratorMutation() {
  return useMutation(startOrchestratorMutationOptions(useQueryClient()));
}
