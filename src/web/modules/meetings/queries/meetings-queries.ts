import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import type { Card } from "../../../../shared/types.js";
import { moveCard } from "@/queries/cards-api";
import { promoteItem } from "@/queries/item-actions-api";
import type { MeetingDraft } from "@/modules/meetings/domain/draft-rows";
import {
  createMeetingItems,
  draftMeetingItems,
  getMeetingTranscript,
} from "./meetings-api.js";

export const meetingsKeys = {
  all: ["meetings"] as const,
  transcript: (meetingId: string) =>
    ["meetings", "transcript", meetingId] as const,
};

/** Build the query options that read one meeting transcript, refetched on every mount. */
export function meetingTranscriptQueryOptions(meetingId: string) {
  return queryOptions({
    queryKey: meetingsKeys.transcript(meetingId),
    queryFn: () => getMeetingTranscript(meetingId),
    staleTime: 0,
  });
}

/**
 * Read a meeting's stored transcript once `enabled` turns true; `refetch` loads it again.
 *
 * @remarks
 * The transcript never loads on mount, so showing a meeting costs no request until the user asks.
 */
export function useLoadMeetingTranscript(meetingId: string, enabled: boolean) {
  return useQuery({ ...meetingTranscriptQueryOptions(meetingId), enabled });
}

export const draftMeetingMutationOptions = {
  mutationFn: (vars: {
    meeting: string;
    notes: string;
    me: string;
    signal: AbortSignal;
  }) => draftMeetingItems(vars.meeting, vars.notes, vars.me, vars.signal),
};

export const createMeetingMutationOptions = {
  mutationFn: (vars: {
    meeting: string;
    drafts: readonly MeetingDraft[];
    notes: string;
  }) => createMeetingItems(vars.meeting, vars.drafts, vars.notes),
};

export const runAgentMutationOptions = {
  mutationFn: async (vars: {
    itemId: string;
  }): Promise<{ card: Card; moved: boolean }> => {
    const { card } = await promoteItem(vars.itemId);
    try {
      await moveCard(card.id, "todo");
    } catch {
      return { card, moved: false };
    }
    return { card, moved: true };
  },
};

/**
 * Draft action items from pasted notes.
 *
 * @remarks
 * A refused draft resolves a failure result with the server code; an abort or a network failure
 * rejects.
 */
export function useDraftMeetingItemsMutation() {
  return useMutation(draftMeetingMutationOptions);
}

/**
 * Create the checked drafts and hand the result to `onResult`.
 *
 * @remarks
 * A refused create resolves a failure result, so the callback sits in `onSuccess` and also runs when
 * the user closes the dialog before the request settles.
 */
export function useCreateMeetingItemsMutation(
  onResult: (result: Awaited<ReturnType<typeof createMeetingItems>>) => void,
) {
  return useMutation({ ...createMeetingMutationOptions, onSuccess: onResult });
}

/**
 * Promote a meeting item and move its card to To Do.
 *
 * @remarks
 * A failed move still resolves, with `moved` false, because the card exists and the caller names it.
 */
export function useRunMeetingAgentMutation() {
  return useMutation(runAgentMutationOptions);
}
