import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { calendarStatusQueryOptions } from "@/queries/calendar-status-queries";
import { createLocalTicket } from "@/queries/cards-api";

export const CALENDAR_POLL_MS = 30_000;

/**
 * Build the status query options the Calendar page polls every 30 seconds.
 *
 * @remarks
 * The shared status query does not poll, because the Settings card reads it too. The page keeps
 * polling in a background tab and refetches on every mount.
 */
export function calendarPollQueryOptions() {
  return queryOptions({
    ...calendarStatusQueryOptions(),
    refetchInterval: CALENDAR_POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
  });
}

/** Subscribe a container to the calendar poll, which keeps polling in the background. */
export function useCalendarPollQuery() {
  return useQuery(calendarPollQueryOptions());
}

export const prepareTicketMutationOptions = {
  mutationFn: (vars: { title: string; description: string }) =>
    createLocalTicket(vars.title, vars.description),
};

/**
 * Run the prepare ticket mutation and hand the result to `onResult`.
 *
 * @remarks
 * The callback sits in the hook options, not in a `mutate` call, so it still runs when the
 * user leaves the page before the request settles.
 */
export function usePrepareTicketMutation(
  onResult: (result: Awaited<ReturnType<typeof createLocalTicket>>) => void,
) {
  return useMutation({ ...prepareTicketMutationOptions, onSuccess: onResult });
}
