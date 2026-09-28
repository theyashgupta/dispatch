import type {
  CalendarChoice,
  CalendarErrorCode,
  CalendarSettingsPatch,
  CalendarSourceConfig,
  CalendarStatus,
  SourceCredential,
} from "../../../shared/types.js";
import {
  calendarErrorCode,
  listMacCalendars,
} from "../../adapters/calendar-mac.js";
import { startEnabledPollers } from "../../adapters/poller.js";
import {
  calendarReadStatus,
  rebuildSources,
  testCalendarRead,
} from "../../adapters/source-gateway.js";
import {
  getOrchestrationConfig,
  patchSourceConfig,
} from "../infra/config-holder.js";
import { readCurrent } from "../domain/vault.js";

const CALENDAR_ICAL_KEY = "CALENDAR_ICAL_URL";

type CalendarResult<T> =
  ({ ok: true } & T) | { ok: false; error: CalendarErrorCode };

/**
 * Read the iCal URL from the Vault, or null when the key is missing or empty.
 *
 * @remarks The value goes straight to the calendar fetch; it is a secret address, so it never
 * reaches a log, a status or an error body.
 */
export async function resolveIcalUrl(): Promise<string | null> {
  const result = await readCurrent(CALENDAR_ICAL_KEY);
  return result.ok && result.value.trim() !== "" ? result.value : null;
}

/** The iCal URL as the Vault credential the source registry hands the calendar source. */
export async function resolveIcalCredential(): Promise<SourceCredential | null> {
  const token = await resolveIcalUrl();
  return token === null
    ? null
    : { token, via: "vault", key: CALENDAR_ICAL_KEY };
}

function currentSettings(): CalendarSourceConfig {
  return getOrchestrationConfig()?.sources?.calendar ?? { mode: "macos" };
}

/**
 * The Calendar card's status: saved settings, whether the Vault key is filled, and the last read.
 *
 * @remarks Filled asks the same resolver the read uses, so a blank value never shows as Filled while
 * Connect answers ical-url-missing.
 */
export async function calendarStatus(): Promise<CalendarStatus> {
  const settings = currentSettings();
  const enabled = settings.enabled === true;
  return {
    enabled,
    mode: settings.mode,
    calendars: settings.calendars ?? [],
    icalFilled: (await resolveIcalUrl()) !== null,
    ...(enabled ? calendarReadStatus() : {}),
  };
}

/** This Mac's calendars for the checklist, or the read's error code. */
export async function listCalendars(): Promise<
  CalendarResult<{ calendars: CalendarChoice[] }>
> {
  try {
    return { ok: true, calendars: await listMacCalendars() };
  } catch (err) {
    return { ok: false, error: calendarErrorCode(err) };
  }
}

async function applySettings(
  patch: CalendarSettingsPatch,
): Promise<CalendarResult<{ status: CalendarStatus }>> {
  const next = { ...currentSettings(), ...patch };
  if (next.enabled === true) {
    const error = await testCalendarRead(next);
    if (error !== null) return { ok: false, error };
  }
  patchSourceConfig("calendar", patch);
  const config = getOrchestrationConfig();
  if (config !== null) rebuildSources(config);
  startEnabledPollers();
  return { ok: true, status: await calendarStatus() };
}

let applying: Promise<unknown> = Promise.resolve();

/**
 * Save calendar settings; when the result is enabled, one test read must pass first.
 *
 * @remarks A failed test read writes nothing (U4-09). Applies run one at a time, so two quick saves
 * cannot interleave their test reads and config writes.
 */
export function applyCalendarSettings(
  patch: CalendarSettingsPatch,
): Promise<CalendarResult<{ status: CalendarStatus }>> {
  const result = applying.then(() => applySettings(patch));
  applying = result.catch(() => undefined);
  return result;
}
