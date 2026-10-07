import { queryOptions, useQuery } from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import { searchCards } from "./search-api.js";

export const searchKeys = {
  all: ["search"] as const,
  cards: (board: BoardKey, q: string) => ["search", "cards", board, q] as const,
};

export function searchCardsQueryOptions(board: BoardKey, q: string) {
  return queryOptions({
    queryKey: searchKeys.cards(board, q),
    queryFn: ({ signal }) => searchCards(board, q, signal),
  });
}

/**
 * Run the card search for a term, skipping the request while `enabled` is false.
 */
export function useSearchCardsQuery(
  board: BoardKey,
  q: string,
  enabled: boolean,
) {
  return useQuery({ ...searchCardsQueryOptions(board, q), enabled });
}
