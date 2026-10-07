import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import type { Item, SlackThread } from "../../../../shared/types.js";
import { draftReplyPrompt } from "../../../../shared/slack-prompt.js";
import { getSlackThread } from "@/queries/slack-thread-api";

export const slackKeys = {
  all: ["slack"] as const,
  thread: (itemId: string) => ["slack", "thread", itemId] as const,
};

/** Build the query options that read one Slack thread, refetched on mount once the data is 2 s old. */
export function slackThreadQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: slackKeys.thread(itemId),
    queryFn: () => getSlackThread(itemId),
    staleTime: 2_000,
  });
}

/**
 * Read a Slack item's thread once `enabled` turns true; `refetch` loads it again.
 *
 * @remarks
 * Nothing prefetches a thread, a deep link included, so a Slack call happens only when the user asks.
 */
export function useLoadSlackThread(itemId: string, enabled: boolean) {
  return useQuery({ ...slackThreadQueryOptions(itemId), enabled });
}

export const draftReplyMutationOptions = {
  mutationFn: async (item: Item): Promise<string> => {
    let thread: SlackThread | null | undefined;
    if (item.meta.threadTs) {
      const loaded = await getSlackThread(item.id);
      thread = loaded.ok ? loaded.thread : null;
    }
    return draftReplyPrompt(item, thread);
  },
};

/**
 * Build the start text for a draft reply to a Slack item.
 *
 * @remarks
 * A threaded item loads its thread first; a failed load still builds the text and the text says the
 * thread could not be loaded.
 */
export function useDraftSlackReplyMutation() {
  return useMutation(draftReplyMutationOptions);
}
