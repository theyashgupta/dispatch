import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ActivityEvent, BoardKey } from "../../shared/types.js";
import { fetchEvents } from "./activity-api.js";

export const activityKeys = {
  all: ["activity"] as const,
  feed: (board: BoardKey) => ["activity", "feed", board] as const,
};

const BUFFER_CAP = 200;

/**
 * Union two event lists deduped by `id`, newest id first, capped at 200.
 *
 * @remarks
 * On a duplicate id the existing entry wins. The same rule serves the feed fetch and every stream
 * frame, so neither arrival order can drop an event.
 */
export function mergeActivity(
  incoming: ActivityEvent[],
  existing: ActivityEvent[],
): ActivityEvent[] {
  const byId = new Map<number, ActivityEvent>();
  for (const event of incoming) byId.set(event.id, event);
  for (const event of existing) byId.set(event.id, event);
  return [...byId.values()].sort((x, y) => y.id - x.id).slice(0, BUFFER_CAP);
}

export function activityFeedQueryOptions(board: BoardKey) {
  return queryOptions({
    queryKey: activityKeys.feed(board),
    queryFn: async ({ client }) =>
      mergeActivity(
        await fetchEvents(board),
        client.getQueryData<ActivityEvent[]>(activityKeys.feed(board)) ?? [],
      ),
    staleTime: 0,
  });
}

/**
 * Read the activity feed of a board.
 *
 * @remarks A reader that mounts beside the always-mounted shell reader passes `refetchOnMount: false`, so it adds no request.
 */
export function useActivityFeedQuery(
  board: BoardKey,
  options?: { refetchOnMount?: boolean },
) {
  return useQuery({ ...activityFeedQueryOptions(board), ...options });
}
