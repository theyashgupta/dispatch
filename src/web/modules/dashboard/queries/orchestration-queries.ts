import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { BoardKey } from "../../../../shared/types.js";
import { orchestrationKey } from "@/queries/attention-actions-queries";
import {
  fetchOrchestrationEvents,
  fetchOrchestrationSummary,
  retryResume,
  type OrchestrationEventsParams,
} from "./orchestration-api.js";

export const orchestrationKeys = {
  all: orchestrationKey,
  summary: (board: BoardKey) =>
    [...orchestrationKey(board), "summary"] as const,
  events: (board: BoardKey, params: OrchestrationEventsParams = {}) =>
    [...orchestrationKey(board), "events", params] as const,
};

export function orchestrationSummaryQueryOptions(board: BoardKey) {
  return queryOptions({
    queryKey: orchestrationKeys.summary(board),
    queryFn: () => fetchOrchestrationSummary(board),
  });
}

export function orchestrationEventsQueryOptions(
  board: BoardKey,
  params: OrchestrationEventsParams = {},
) {
  return queryOptions({
    queryKey: orchestrationKeys.events(board, params),
    queryFn: () => fetchOrchestrationEvents(board, params),
  });
}

export function useOrchestrationSummaryQuery(board: BoardKey) {
  return useQuery(orchestrationSummaryQueryOptions(board));
}

export function useOrchestrationEventsQuery(
  board: BoardKey,
  params: OrchestrationEventsParams = {},
) {
  return useQuery(orchestrationEventsQueryOptions(board, params));
}

/** The mutation options of "Try resume again", which refresh the orchestration reads of the board after it settles. */
export function retryResumeMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (cardId: string) => retryResume(cardId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.all(board) }),
  };
}

export function useRetryResumeMutation(board: BoardKey) {
  return useMutation(retryResumeMutationOptions(useQueryClient(), board));
}
