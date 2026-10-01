import { queryOptions, useQuery } from "@tanstack/react-query";
import { getSlackThread } from "./slack-api.js";

export const slackKeys = {
  all: ["slack"] as const,
  thread: (itemId: string) => ["slack", "thread", itemId] as const,
};

export function slackThreadQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: slackKeys.thread(itemId),
    queryFn: () => getSlackThread(itemId),
    staleTime: 0,
  });
}

export function useSlackThreadQuery(itemId: string) {
  return useQuery(slackThreadQueryOptions(itemId));
}
