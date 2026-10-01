import { Router } from "express";
import { z } from "zod";
import { CALENDAR_TITLE_MAX, CALENDARS_MAX } from "../../shared/types.js";
import { ConflictError, InternalError } from "../services/domain/errors.js";
import {
  applyCalendarSettings,
  calendarStatus,
  listCalendars,
} from "../services/orchestration/calendar.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

export const calendarRouter = Router();

const calendarTitleSchema = z
  .string("invalid-calendars")
  .refine(
    (title) => title.trim() !== "" && title.length <= CALENDAR_TITLE_MAX,
    "invalid-calendars",
  );

/** The `PUT /calendar/settings` body; the first wrong field among mode, calendars and enabled names the error. */
const settingsSchema = z.object(
  {
    mode: z.enum(["macos", "ical"], "invalid-mode").optional(),
    calendars: z
      .array(calendarTitleSchema, "invalid-calendars")
      .refine((titles) => titles.length <= CALENDARS_MAX, "invalid-calendars")
      .optional(),
    enabled: z.boolean("invalid-enabled").optional(),
  },
  "invalid-body",
);

/**
 * Log a failed calendar request's first error line and build the fixed-code 500 for it.
 */
function failure(route: string, code: string, err: unknown): InternalError {
  console.warn(
    `[calendar/${route}] failed:`,
    err instanceof Error ? err.message.split("\n")[0] : "unknown error",
  );
  return new InternalError(code);
}

calendarRouter.get("/calendar/status", async (_req, res) => {
  try {
    res.json(await calendarStatus());
  } catch (err) {
    throw failure("status", "status-failed", err);
  }
});

calendarRouter.post("/calendar/calendars", async (_req, res) => {
  const result = await listCalendars().catch((err: unknown) => {
    throw failure("calendars", "failed", err);
  });
  if (!result.ok) throw new ConflictError(result.error);
  res.json({ calendars: result.calendars });
});

calendarRouter.put("/calendar/settings", async (req, res) => {
  const patch = parseOrThrow(settingsSchema, req.body);
  const result = await applyCalendarSettings(patch).catch((err: unknown) => {
    throw failure("settings", "settings-failed", err);
  });
  if (!result.ok) throw new ConflictError(result.error);
  res.json(result.status);
});

calendarRouter.use(httpErrorHandler);
