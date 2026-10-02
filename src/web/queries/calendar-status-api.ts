import type { CalendarStatus } from "../../shared/types.js";
import { http } from "@/lib/http";

/** Read the Calendar source status: GET /api/calendar/status. */
export async function getCalendarStatus(): Promise<CalendarStatus> {
  const result = await http<CalendarStatus>("/api/calendar/status");
  if (!result.ok) throw new Error(`getCalendarStatus failed: ${result.status}`);
  return result.data;
}
