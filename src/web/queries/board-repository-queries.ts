import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import { boardListKeys } from "./board-list-queries.js";
import {
  initBoardRepository,
  type InitRepositoryResult,
} from "./board-repository-api.js";
import { workspaceFoldersKeys } from "./workspace-folders-queries.js";

/**
 * Build the mutation options that make a git repository in a board folder.
 *
 * @remarks
 * The board list (which holds the board detail) and the folder list of that board refresh before
 * the mutation resolves, so a caller that selects the new repository finds it in the folder list.
 */
export function initRepositoryMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: initBoardRepository,
    onSuccess: async (result: InitRepositoryResult, key: BoardKey) => {
      if (!result.ok) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: boardListKeys.all }),
        queryClient.invalidateQueries({
          queryKey: workspaceFoldersKeys.folders(key),
        }),
      ]);
    },
  };
}

export function useInitRepositoryMutation() {
  return useMutation(initRepositoryMutationOptions(useQueryClient()));
}

/**
 * The error text of an init repository mutation, or null when it has none.
 *
 * @remarks A refusal shows its copy and, when the server sent one, the git message after it.
 */
export function initRepositoryErrorText(
  data: InitRepositoryResult | undefined,
  error: Error | null,
): string | null {
  if (data?.ok === false) {
    return data.detail === undefined
      ? data.error
      : `${data.error} ${data.detail}`;
  }
  return error?.message ?? null;
}
