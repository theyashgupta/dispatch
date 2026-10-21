import { queryOptions, useQuery } from "@tanstack/react-query";
import type { BoardKey } from "../../../../shared/types.js";
import { orchestrationKey } from "@/queries/attention-actions-queries";
import {
  fetchOrchestrationEvents,
  type OrchestrationEventsParams,
} from "./orchestration-api.js";

export const orchestrationKeys = {
  all: orchestrationKey,
  events: (board: BoardKey, params: OrchestrationEventsParams = {}) =>
    [...orchestrationKey(board), "events", params] as const,
};

export function orchestrationEventsQueryOptions(
  board: BoardKey,
  params: OrchestrationEventsParams = {},
) {
  return queryOptions({
    queryKey: orchestrationKeys.events(board, params),
    queryFn: () => fetchOrchestrationEvents(board, params),
  });
}

export function useOrchestrationEventsQuery(
  board: BoardKey,
  params: OrchestrationEventsParams = {},
) {
  return useQuery(orchestrationEventsQueryOptions(board, params));
}
