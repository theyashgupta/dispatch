import { useEffect, useRef } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** True when the running key changed between two snapshots; undefined is the first render and null is no snapshot yet. */
export function shouldRefreshCounts(
  previous: string | null | undefined,
  next: string | null,
): boolean {
  return (
    typeof previous === "string" &&
    typeof next === "string" &&
    previous !== next
  );
}

/** True when the same board's running key changed since the previous render; a board switch never refetches. */
export function shouldRefreshOnLoopChange(
  previous: { board: string; key: string | null } | undefined,
  board: string,
  key: string | null,
): boolean {
  return (
    previous !== undefined &&
    previous.board === board &&
    shouldRefreshCounts(previous.key, key)
  );
}

/**
 * Refetch the board counts when the selected board's running loop key changes.
 */
export function useRefreshCountsOnLoopChange(
  board: string,
  key: string | null,
): void {
  const queryClient = useQueryClient();
  const previous = useRef<{ board: string; key: string | null } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (shouldRefreshOnLoopChange(previous.current, board, key)) {
      void queryClient.invalidateQueries({ queryKey: boardListKeys.counts });
    }
    previous.current = { board, key };
  }, [board, key, queryClient]);
}
