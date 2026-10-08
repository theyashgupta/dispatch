import { queryOptions, useQuery } from "@tanstack/react-query";
import type { BoardList } from "../../shared/types.js";
import { getBoardCounts, getBoardList } from "./board-list-api.js";

const COUNTS_POLL_MS = 15_000;

export const boardListKeys = {
  all: ["boards"] as const,
  list: ["boards", "list"] as const,
  counts: ["boards", "counts"] as const,
};

export function boardListQueryOptions() {
  return queryOptions({ queryKey: boardListKeys.list, queryFn: getBoardList });
}

/**
 * Build the counts query options: `poll` true refetches every 15 s, false disables the query, omitted shares the cache without a timer.
 */
export function boardCountsQueryOptions(poll?: boolean) {
  return queryOptions({
    queryKey: boardListKeys.counts,
    queryFn: getBoardCounts,
    enabled: poll !== false,
    refetchInterval: poll === true ? COUNTS_POLL_MS : false,
  });
}

export function useBoardListQuery<T = BoardList>(
  select?: (data: BoardList) => T,
) {
  return useQuery({ ...boardListQueryOptions(), select });
}

/**
 * Read the board counts, polling every 15 s when `poll` is true and idle when it is false (U3-05).
 *
 * @remarks Only the shell passes `poll`, so one timer runs; a reader that omits it just shares the cached counts.
 */
export function useBoardCountsQuery(poll?: boolean) {
  return useQuery(boardCountsQueryOptions(poll));
}
