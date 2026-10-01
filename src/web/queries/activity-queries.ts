import { queryOptions } from "@tanstack/react-query";
import type { ActivityEvent } from "../../shared/types.js";
import { fetchEvents } from "./activity-api.js";

export const activityKeys = {
  all: ["activity"] as const,
  feed: ["activity", "feed"] as const,
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

export function activityFeedQueryOptions() {
  return queryOptions({
    queryKey: activityKeys.feed,
    queryFn: async ({ client }) =>
      mergeActivity(
        await fetchEvents(),
        client.getQueryData<ActivityEvent[]>(activityKeys.feed) ?? [],
      ),
    staleTime: 0,
  });
}
