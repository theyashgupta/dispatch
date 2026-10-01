import { queryOptions } from "@tanstack/react-query";
import { granolaKeys } from "@/queries/granola-queries";
import { getMeetingTranscript } from "./meetings-api.js";

export {
  granolaQueryOptions,
  useGranolaQuery,
} from "@/queries/granola-queries";

export const meetingsKeys = {
  all: ["meetings"] as const,
  granola: granolaKeys.status,
  transcript: (meetingId: string) =>
    ["meetings", "transcript", meetingId] as const,
};

export function meetingTranscriptQueryOptions(meetingId: string) {
  return queryOptions({
    queryKey: meetingsKeys.transcript(meetingId),
    queryFn: () => getMeetingTranscript(meetingId),
  });
}
