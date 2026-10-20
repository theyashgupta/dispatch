import { queryOptions, useQuery } from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import { orchestrationKey } from "./attention-actions-queries.js";
import { fetchOrchestrationSummary } from "./orchestration-summary-api.js";

export function orchestrationSummaryQueryOptions(board: BoardKey) {
  return queryOptions({
    queryKey: [...orchestrationKey(board), "summary"] as const,
    queryFn: () => fetchOrchestrationSummary(board),
  });
}

/** Read the orchestration summary of a board, with the cost total of each group. */
export function useOrchestrationSummaryQuery(board: BoardKey) {
  return useQuery(orchestrationSummaryQueryOptions(board));
}
