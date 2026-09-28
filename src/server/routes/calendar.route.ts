import { Router, type Request, type Response } from "express";
import {
  CALENDAR_TITLE_MAX,
  CALENDARS_MAX,
  type CalendarSettingsPatch,
} from "../../shared/types.js";
import {
  applyCalendarSettings,
  calendarStatus,
  listCalendars,
} from "../services/orchestration/calendar.js";

export const calendarRouter = Router();

/**
 * Validate a settings body into a patch, or name the first field that is wrong.
 */
function parseSettings(
  body: unknown,
): { patch: CalendarSettingsPatch } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "invalid-body" };
  }
  const b = body as Record<string, unknown>;
  const patch: CalendarSettingsPatch = {};
  if (b.mode !== undefined) {
    if (b.mode !== "macos" && b.mode !== "ical")
      return { error: "invalid-mode" };
    patch.mode = b.mode;
  }
  if (b.calendars !== undefined) {
    const titles = b.calendars;
    if (
      !Array.isArray(titles) ||
      titles.length > CALENDARS_MAX ||
      !titles.every(
        (t) =>
          typeof t === "string" &&
          t.trim() !== "" &&
          t.length <= CALENDAR_TITLE_MAX,
      )
    ) {
      return { error: "invalid-calendars" };
    }
    patch.calendars = titles as string[];
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return { error: "invalid-enabled" };
    patch.enabled = b.enabled;
  }
  return { patch };
}

async function putSettingsHandler(req: Request, res: Response): Promise<void> {
  const parsed = parseSettings(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const result = await applyCalendarSettings(parsed.patch);
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json(result.status);
}

async function listCalendarsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await listCalendars();
  if (result.ok) res.json({ calendars: result.calendars });
  else res.status(409).json({ error: result.error });
}

/**
 * Answer a failed calendar request with a fixed code and log only the error's first line.
 */
function fail(res: Response, route: string, code: string, err: unknown): void {
  console.warn(
    `[calendar/${route}] failed:`,
    err instanceof Error ? err.message.split("\n")[0] : "unknown error",
  );
  if (!res.headersSent) res.status(500).json({ error: code });
}

calendarRouter.get("/calendar/status", (_req, res) => {
  void calendarStatus()
    .then((status) => res.json(status))
    .catch((err: unknown) => fail(res, "status", "status-failed", err));
});

calendarRouter.post("/calendar/calendars", (req, res) => {
  void listCalendarsHandler(req, res).catch((err: unknown) =>
    fail(res, "calendars", "failed", err),
  );
});

calendarRouter.put("/calendar/settings", (req, res) => {
  void putSettingsHandler(req, res).catch((err: unknown) =>
    fail(res, "settings", "settings-failed", err),
  );
});
