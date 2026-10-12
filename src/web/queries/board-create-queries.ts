import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { boardListKeys } from "./board-list-queries.js";
import { createBoard, type CreateBoardResult } from "./board-create-api.js";

/**
 * Build the mutation options that create a board.
 *
 * @remarks
 * The board list refreshes before the mutation resolves, so a navigation right after the create
 * finds the new board in the list instead of falling back to the default board.
 */
export function createBoardMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: createBoard,
    onSuccess: async (result: CreateBoardResult) => {
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: boardListKeys.all });
      }
    },
  };
}

export function useCreateBoardMutation() {
  return useMutation(createBoardMutationOptions(useQueryClient()));
}
