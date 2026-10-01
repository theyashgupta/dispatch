import { calendarStatusKeys } from "@/queries/calendar-status-queries";

export {
  calendarStatusQueryOptions,
  useCalendarStatusQuery,
} from "@/queries/calendar-status-queries";

export const calendarKeys = {
  all: ["calendar"] as const,
  status: calendarStatusKeys.status,
};
