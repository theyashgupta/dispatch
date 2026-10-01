import { queryOptions, useQuery } from "@tanstack/react-query";
import { getCalendarStatus } from "./calendar-status-api.js";

export const calendarStatusKeys = {
  status: ["calendar", "status"] as const,
};

export function calendarStatusQueryOptions() {
  return queryOptions({
    queryKey: calendarStatusKeys.status,
    queryFn: getCalendarStatus,
  });
}

export function useCalendarStatusQuery() {
  return useQuery(calendarStatusQueryOptions());
}
