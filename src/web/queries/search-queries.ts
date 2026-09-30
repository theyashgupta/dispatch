import { queryOptions } from "@tanstack/react-query";
import { searchCards } from "./search-api.js";

export const searchKeys = {
  all: ["search"] as const,
  cards: (q: string) => ["search", "cards", q] as const,
};

export function searchCardsQueryOptions(q: string) {
  return queryOptions({
    queryKey: searchKeys.cards(q),
    queryFn: ({ signal }) => searchCards(q, signal),
  });
}
