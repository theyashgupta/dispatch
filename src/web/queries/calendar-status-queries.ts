import { queryOptions } from "@tanstack/react-query";
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
