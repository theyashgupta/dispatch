import { queryOptions, useQuery } from "@tanstack/react-query";
import { getGranola, getMeetingTranscript } from "./meetings-api.js";

export const meetingsKeys = {
  all: ["meetings"] as const,
  granola: ["meetings", "granola"] as const,
  transcript: (meetingId: string) =>
    ["meetings", "transcript", meetingId] as const,
};

export function granolaQueryOptions() {
  return queryOptions({
    queryKey: meetingsKeys.granola,
    queryFn: getGranola,
  });
}

export function meetingTranscriptQueryOptions(meetingId: string) {
  return queryOptions({
    queryKey: meetingsKeys.transcript(meetingId),
    queryFn: () => getMeetingTranscript(meetingId),
  });
}

export function useGranolaQuery() {
  return useQuery(granolaQueryOptions());
}
