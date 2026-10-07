import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { BoardSnapshot, Column } from "../../../../shared/types.js";
import { boardSnapshotKeys } from "@/queries/board-snapshot-queries";
import { moveCard } from "@/queries/cards-api";
import { getCard, getCardComments } from "./board-api.js";

export const boardKeys = {
  all: ["board"] as const,
  detail: (id: string) => ["board", "card", id] as const,
  comments: (id: string) => ["board", "card", id, "comments"] as const,
};

export function cardQueryOptions(id: string) {
  return queryOptions({
    queryKey: boardKeys.detail(id),
    queryFn: () => getCard(id),
  });
}

export function cardCommentsQueryOptions(id: string) {
  return queryOptions({
    queryKey: boardKeys.comments(id),
    queryFn: () => getCardComments(id),
  });
}

export function useCardQuery(id: string) {
  return useQuery(cardQueryOptions(id));
}

interface MoveCardVariables {
  id: string;
  column: Column;
}

/**
 * Build the mutation options that move a card with an optimistic cache write.
 *
 * @remarks
 * The mutation cancels in-flight snapshot queries first so a refetch cannot overwrite the optimistic write. Rollback restores only the moved card's previous column in each snapshot entry, so frames that landed for other cards during the request survive.
 */
export function moveCardMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: ({ id, column }: MoveCardVariables) => moveCard(id, column),
    onMutate: async ({ id, column }: MoveCardVariables) => {
      await queryClient.cancelQueries({ queryKey: boardSnapshotKeys.all });
      const snapshots = queryClient
        .getQueriesData<BoardSnapshot>({ queryKey: boardSnapshotKeys.all })
        .map(([key, data]): [QueryKey, Column | undefined] => [
          key,
          data?.cards.find((c) => c.id === id)?.column,
        ]);
      queryClient.setQueriesData<BoardSnapshot>(
        { queryKey: boardSnapshotKeys.all },
        (old) =>
          old && {
            ...old,
            cards: old.cards.map((c) => (c.id === id ? { ...c, column } : c)),
          },
      );
      return { snapshots };
    },
    onError: (
      _err: Error,
      { id }: MoveCardVariables,
      context: { snapshots: [QueryKey, Column | undefined][] } | undefined,
    ) => {
      context?.snapshots.forEach(([key, previous]) => {
        if (previous === undefined) return;
        queryClient.setQueryData<BoardSnapshot>(
          key,
          (old) =>
            old && {
              ...old,
              cards: old.cards.map((c) =>
                c.id === id ? { ...c, column: previous } : c,
              ),
            },
        );
      });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: boardSnapshotKeys.all }),
  };
}

export function useMoveCardMutation() {
  const queryClient = useQueryClient();
  return useMutation(moveCardMutationOptions(queryClient));
}
