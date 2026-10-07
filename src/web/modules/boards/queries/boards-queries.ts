import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { BoardKey } from "../../../../shared/types.js";
import { boardListKeys } from "@/queries/board-list-queries";
import type { UpdateBoardInput } from "@/modules/boards/domain/board-form";
import {
  archiveBoard,
  createBoard,
  getBoardDetail,
  restoreBoard,
  updateBoard,
  type BoardWriteResult,
} from "./boards-api.js";

export const boardsKeys = {
  detail: (key: BoardKey) => [...boardListKeys.all, "detail", key] as const,
};

/**
 * Read one board fresh each time the edit form opens.
 *
 * @remarks The default board's folders come from Settings, so a cached copy could show a list
 * that Settings already changed.
 */
export function boardDetailQueryOptions(key: BoardKey) {
  return queryOptions({
    queryKey: boardsKeys.detail(key),
    queryFn: () => getBoardDetail(key),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useBoardDetailQuery(key: BoardKey) {
  return useQuery(boardDetailQueryOptions(key));
}

/**
 * Refresh the board list and counts before the mutation resolves.
 *
 * @remarks A navigation right after a write must see the fresh list, or the root route would
 * reject a board that was just created or keep one that was just archived.
 */
function refreshBoards(queryClient: QueryClient) {
  return async (result: BoardWriteResult) => {
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: boardListKeys.all });
    }
  };
}

export function createBoardMutationOptions(queryClient: QueryClient) {
  return { mutationFn: createBoard, onSuccess: refreshBoards(queryClient) };
}

export function updateBoardMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: { key: BoardKey; input: UpdateBoardInput }) =>
      updateBoard(vars.key, vars.input),
    onSuccess: refreshBoards(queryClient),
  };
}

export function archiveBoardMutationOptions(queryClient: QueryClient) {
  return { mutationFn: archiveBoard, onSuccess: refreshBoards(queryClient) };
}

export function restoreBoardMutationOptions(queryClient: QueryClient) {
  return { mutationFn: restoreBoard, onSuccess: refreshBoards(queryClient) };
}

export function useCreateBoardMutation() {
  return useMutation(createBoardMutationOptions(useQueryClient()));
}

export function useUpdateBoardMutation() {
  return useMutation(updateBoardMutationOptions(useQueryClient()));
}

export function useArchiveBoardMutation() {
  return useMutation(archiveBoardMutationOptions(useQueryClient()));
}

export function useRestoreBoardMutation() {
  return useMutation(restoreBoardMutationOptions(useQueryClient()));
}
