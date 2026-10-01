import type {
  CalendarChoice,
  CalendarErrorCode,
  CalendarSettingsPatch,
  CalendarStatus,
} from "../../../../shared/types.js";
import { http, type ApiResult } from "@/lib/http";

/** Read the Calendar source status: GET /api/calendar/status. */
export async function getCalendarStatus(): Promise<CalendarStatus> {
  const result = await http<CalendarStatus>("/api/calendar/status");
  if (!result.ok) throw new Error(`getCalendarStatus failed: ${result.status}`);
  return result.data;
}

type CalendarResult<T> =
  { ok: true; value: T } | { ok: false; error: CalendarErrorCode };

function calendarResult<T>(
  result: ApiResult<unknown>,
  read: (body: unknown) => T,
): CalendarResult<T> {
  if (!result.ok) {
    if (result.status === 409) {
      return {
        ok: false,
        error: (result.error ?? "failed") as CalendarErrorCode,
      };
    }
    throw new Error(`calendar request failed: ${result.status}`);
  }
  return { ok: true, value: read(result.data) };
}

/**
 * List this Mac's calendars: POST /api/calendar/calendars with no body.
 *
 * @remarks
 * A POST, so a cross-site page cannot trigger the macOS Calendars prompt. A 409 carries the read's
 * error code, which the card shows, and other failures throw.
 */
export async function listCalendars(): Promise<
  CalendarResult<CalendarChoice[]>
> {
  return calendarResult(
    await http("/api/calendar/calendars", { method: "POST" }),
    (body) => (body as { calendars: CalendarChoice[] }).calendars,
  );
}

/**
 * Save Calendar settings: PUT /api/calendar/settings.
 *
 * @remarks
 * Enabling runs one test read on the server, so a 409 carries its error code and nothing was
 * saved.
 */
export async function putCalendarSettings(
  patch: CalendarSettingsPatch,
): Promise<CalendarResult<CalendarStatus>> {
  return calendarResult(
    await http("/api/calendar/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
    (body) => body as CalendarStatus,
  );
}
