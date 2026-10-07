import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { BoardSnapshot, Card, Column } from "../../../../shared/types.js";
import { boardSnapshotKeys } from "@/queries/board-snapshot-queries";
import { moveCard } from "@/queries/cards-api";
import { getCard, getCardComments } from "./board-api.js";
import type { FailedMoveEvent } from "@/modules/board/domain/failed-move-notice";
import {
  applyMoves,
  compensationTargets,
  type GroupMove,
  restoreMoves,
  strandedMoves,
} from "@/modules/board/domain/group-move";

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
 * `onMutate` stays synchronous so the write renders in the same commit as the drop. An awaited
 * cancel defers it past that commit and the card flashes in its old column.
 */
export function moveCardMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: ({ id, column }: MoveCardVariables) => moveCard(id, column),
    onMutate: ({ id, column }: MoveCardVariables) => {
      void queryClient.cancelQueries({ queryKey: boardSnapshotKeys.all });
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
      { id, column }: MoveCardVariables,
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
                c.id === id && c.column === column
                  ? { ...c, column: previous }
                  : c,
              ),
            },
        );
      });
    },
  };
}

export function useMoveCardMutation() {
  const queryClient = useQueryClient();
  return useMutation(moveCardMutationOptions(queryClient));
}

interface GroupMoveVariables {
  moves: readonly GroupMove[];
  column: Column;
  onProgress?: (event: FailedMoveEvent) => void;
  signal?: AbortSignal;
}

export type GroupMoveOutcome = "succeeded" | "failed" | "superseded";

const COMPENSATION_RETRY_MS = 300;

let groupMoveGeneration = 0;

/**
 * Build the mutation options that move several cards to one column with compensation.
 *
 * @remarks
 * The moves arrive planned by the caller and are never re-planned from the cache, because an older
 * snapshot entry can still hold a stale column for a card.
 */
export function groupMoveMutationOptions(queryClient: QueryClient) {
  function writeCards(update: (cards: Card[]) => Card[]) {
    queryClient.setQueriesData<BoardSnapshot>(
      { queryKey: boardSnapshotKeys.all },
      (old) => old && { ...old, cards: update(old.cards) },
    );
  }

  return {
    onMutate: ({ moves, column }: GroupMoveVariables) => {
      void queryClient.cancelQueries({ queryKey: boardSnapshotKeys.all });
      writeCards((cards) => applyMoves(cards, moves, column));
    },
    mutationFn: async ({
      moves,
      column,
      onProgress,
      signal,
    }: GroupMoveVariables): Promise<GroupMoveOutcome> => {
      const generation = ++groupMoveGeneration;
      const superseded = () => generation !== groupMoveGeneration;
      const report = (event: FailedMoveEvent) => {
        if (signal?.aborted !== true) onProgress?.(event);
      };

      const results = await Promise.allSettled(
        moves.map((m) => moveCard(m.id, column)),
      );
      if (superseded()) return "superseded";
      if (results.every((r) => r.status === "fulfilled")) {
        report({ type: "succeeded" });
        return "succeeded";
      }

      console.error(
        "performGroupMove failed; restoring the previous columns",
        results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r): unknown => r.reason),
      );
      writeCards((cards) => restoreMoves(cards, moves, column));
      report({ type: "failed", id: generation, count: moves.length });

      const stranded = strandedMoves(moves, results, column);
      if (stranded.length > 0) {
        console.error(
          "performGroupMove cannot compensate a move the manual allowlist refuses; cards stranded",
          stranded.map((m) => m.id),
          column,
        );
        report({ type: "stranded", id: generation });
      }

      const targets = compensationTargets(moves, results, column);
      if (superseded()) return "superseded";
      const compensation = await Promise.allSettled(
        targets.map((m) => moveCard(m.id, m.from)),
      );
      for (const [i, result] of compensation.entries()) {
        if (result.status !== "rejected") continue;
        const { id, from } = targets[i];
        await new Promise((resolve) =>
          setTimeout(resolve, COMPENSATION_RETRY_MS),
        );
        if (superseded()) return "superseded";
        try {
          await moveCard(id, from);
        } catch (retryErr) {
          console.error(
            "performGroupMove compensation failed after one retry; card stranded",
            id,
            from,
            retryErr,
          );
          report({ type: "stranded", id: generation });
        }
      }
      report({ type: "settled", id: generation });
      return "failed";
    },
  };
}

/** Move several cards to one column with compensation on failure. */
export function useGroupMoveMutation() {
  const queryClient = useQueryClient();
  return useMutation(groupMoveMutationOptions(queryClient));
}
