import { queryOptions, useQuery } from "@tanstack/react-query";
import { getCalendarStatus } from "./calendar-api.js";

export const calendarKeys = {
  all: ["calendar"] as const,
  status: ["calendar", "status"] as const,
};

export function calendarStatusQueryOptions() {
  return queryOptions({
    queryKey: calendarKeys.status,
    queryFn: getCalendarStatus,
  });
}

export function useCalendarStatusQuery() {
  return useQuery(calendarStatusQueryOptions());
}
