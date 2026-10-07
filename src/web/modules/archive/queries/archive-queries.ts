import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { BoardKey } from "../../../../shared/types.js";
import { restoreArchived } from "@/queries/archive-api";
import { deleteArchived, listArchive } from "./archive-api.js";

export const archiveKeys = {
  all: ["archive"] as const,
  list: (board: BoardKey) => ["archive", "list", board] as const,
};

/**
 * Read the archive list fresh on every page open, and drop it once the page closes.
 *
 * @remarks
 * The legacy page read on mount and showed nothing until the read answered; a cached list would show
 * rows that a write made elsewhere (an unwind, an undo, another tab) already removed.
 */
export function archiveQueryOptions(board: BoardKey) {
  return queryOptions({
    queryKey: archiveKeys.list(board),
    queryFn: () => listArchive(board),
    gcTime: 0,
  });
}

export function useArchiveQuery(board: BoardKey) {
  return useQuery(archiveQueryOptions(board));
}

/**
 * Build the mutation options that restore an archived group.
 *
 * @remarks
 * A restore marks the list stale so the group leaves it. A refusal (404 or 409) resolves
 * `{ ok: false, error }` and leaves the cache alone. Any other failure rejects.
 */
export function restoreArchivedMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (id: string) => restoreArchived(id),
    onSuccess: (result: Awaited<ReturnType<typeof restoreArchived>>) => {
      if (result.ok) {
        return queryClient.invalidateQueries({ queryKey: archiveKeys.all });
      }
    },
  };
}

export function useRestoreArchivedMutation() {
  const queryClient = useQueryClient();
  return useMutation(restoreArchivedMutationOptions(queryClient));
}

/**
 * Build the mutation options that hard-delete an archived group.
 *
 * @remarks
 * The list is marked stale after a delete and after a refusal (404 or 409), because a refusal
 * records its reason on the row. Any other failure rejects and leaves the cache alone.
 */
export function deleteArchivedMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: { id: string; force: boolean }) =>
      deleteArchived(vars.id, vars.force),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: archiveKeys.all }),
  };
}

export function useDeleteArchivedMutation() {
  const queryClient = useQueryClient();
  return useMutation(deleteArchivedMutationOptions(queryClient));
}
