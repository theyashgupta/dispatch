import { permissionErrorCode } from "../../../shared/calendar-permission.js";
import type {
  CalendarChoice,
  CalendarErrorCode,
  CalendarPermission,
  CalendarSettingsPatch,
  CalendarSourceConfig,
  CalendarStatus,
  SourceCredential,
} from "../../../shared/types.js";
import {
  calendarErrorCode,
  listMacCalendars,
  readPermission,
  requestCalendarAccess,
} from "../../adapters/calendar-mac.js";
import { pollNowAndWait, startEnabledPollers } from "../../adapters/poller.js";
import {
  calendarReadStatus,
  rebuildSources,
  testCalendarRead,
} from "../../adapters/source-gateway.js";
import {
  getOrchestrationConfig,
  patchSourceConfig,
} from "../infra/config-holder.js";
import { readCurrent } from "../infra/vault.js";

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

const PERMISSION_MAX_AGE_MS = 60_000;
const GRANT_POLL_WAIT_MS = 5_000;

interface PermissionEntry {
  permission: CalendarPermission;
  missingCalendars: string[];
  at: number;
}

let permissionCache: PermissionEntry | null = null;
let permissionRefresh: Promise<PermissionEntry> | null = null;
let permissionGeneration = 0;

/**
 * Drop the cached permission and the refresh in flight, so the next status read starts from a fresh read.
 *
 * @remarks Bumping the generation keeps a refresh that already started from writing its older answer back.
 */
export function invalidatePermission(): void {
  permissionGeneration += 1;
  permissionCache = null;
  permissionRefresh = null;
}

/**
 * The saved calendar titles that this Mac no longer lists, in saved order.
 *
 * @remarks Lists only for a granted macOS connection with saved titles; any other state has none missing.
 * A failed calendar list also gives none, so it never hides a permission that was read.
 */
async function missingTitles(
  permission: CalendarPermission,
): Promise<string[]> {
  const settings = currentSettings();
  const saved = settings.calendars ?? [];
  if (
    permission !== "granted" ||
    settings.mode !== "macos" ||
    saved.length === 0
  ) {
    return [];
  }
  try {
    const present = new Set((await listMacCalendars()).map((c) => c.title));
    return saved.filter((title) => !present.has(title));
  } catch {
    return [];
  }
}

/**
 * Read the permission and the missing titles now and cache them.
 *
 * @remarks A failed permission read caches `unknown`, and a result that a newer check has overtaken is not cached.
 */
async function refreshPermission(): Promise<PermissionEntry> {
  const generation = permissionGeneration;
  let entry: PermissionEntry;
  try {
    const permission = await readPermission();
    entry = {
      permission,
      missingCalendars: await missingTitles(permission),
      at: Date.now(),
    };
  } catch {
    entry = { permission: "unknown", missingCalendars: [], at: Date.now() };
  }
  if (generation === permissionGeneration) permissionCache = entry;
  return entry;
}

/** The permission a Check access cached in the last 60 s, else `unknown`; it never reads EventKit. */
function icalPermission(): CalendarPermission {
  return permissionCache !== null &&
    Date.now() - permissionCache.at <= PERMISSION_MAX_AGE_MS
    ? permissionCache.permission
    : "unknown";
}

/**
 * The cached permission, read again when it is over 60 s old or a poll has run since it was read.
 *
 * @remarks Status reads never request access, so a poll or a page load cannot raise the macOS prompt.
 */
async function currentPermission(): Promise<PermissionEntry> {
  const polled = calendarReadStatus().lastPolledAt;
  const stale =
    permissionCache === null ||
    Date.now() - permissionCache.at > PERMISSION_MAX_AGE_MS ||
    (polled !== undefined && Date.parse(polled) > permissionCache.at);
  if (!stale && permissionCache !== null) return permissionCache;
  if (permissionRefresh === null) {
    const refresh: Promise<PermissionEntry> = refreshPermission().finally(
      () => {
        if (permissionRefresh === refresh) permissionRefresh = null;
      },
    );
    permissionRefresh = refresh;
  }
  return permissionRefresh;
}

let accessRequest: Promise<CalendarPermission> | null = null;
let accessCheck: Promise<void> | null = null;

/**
 * Ask macOS for Calendar access, sharing one request among every caller while it waits.
 *
 * @remarks Check access and Connect both call it, so two clicks cannot start two helpers or raise two prompts.
 */
function requestAccessOnce(): Promise<CalendarPermission> {
  accessRequest ??= requestCalendarAccess().finally(() => {
    accessRequest = null;
  });
  return accessRequest;
}

/**
 * The Calendar card's status: saved settings, the permission state, and the last read.
 *
 * @remarks Filled asks the same resolver the read uses, so a blank value never shows as Filled while
 * Connect answers ical-url-missing. The permission and missing titles show also while the connection is
 * off. In iCal mode there is no EventKit read: the permission is the one a Check access cached in the
 * last 60 s, else `unknown`.
 */
export async function calendarStatus(): Promise<CalendarStatus> {
  const settings = currentSettings();
  const enabled = settings.enabled === true;
  const { permission, missingCalendars } =
    settings.mode === "macos"
      ? await currentPermission()
      : { permission: icalPermission(), missingCalendars: [] };
  return {
    enabled,
    mode: settings.mode,
    calendars: settings.calendars ?? [],
    icalFilled: (await resolveIcalUrl()) !== null,
    permission,
    missingCalendars,
    ...(enabled ? calendarReadStatus() : {}),
  };
}

/**
 * Ask macOS for Calendar access and return the status that follows.
 *
 * @remarks One of the two calls that may raise the prompt, the other being Connect; both share one
 * request. The answer is cached unless a later invalidate overtook it, so a `prompt-timeout` still shows
 * in the next status read. A granted answer on an enabled macOS connection waits up to 5 s for one
 * calendar poll, so the answered status no longer carries a stale read error.
 */
export async function checkCalendarAccess(): Promise<CalendarStatus> {
  accessCheck ??= recordAccessCheck().finally(() => {
    accessCheck = null;
  });
  await accessCheck;
  return calendarStatus();
}

/**
 * Run the shared access request, then cache its answer and start the poll once for every caller.
 *
 * @remarks Two Check access calls that join one request must not each invalidate the cache, or the
 * second invalidate drops the first answer and a `prompt-timeout` reads back as `not-asked`.
 */
async function recordAccessCheck(): Promise<void> {
  const permission = await requestAccessOnce();
  invalidatePermission();
  const generation = permissionGeneration;
  const entry: PermissionEntry = {
    permission,
    missingCalendars: await missingTitles(permission),
    at: Date.now(),
  };
  if (generation === permissionGeneration) permissionCache = entry;
  const settings = currentSettings();
  if (
    permission === "granted" &&
    settings.enabled === true &&
    settings.mode === "macos"
  ) {
    await pollNowAndWait("calendar", GRANT_POLL_WAIT_MS);
  }
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
  const saved = currentSettings();
  const next = { ...saved, ...patch };
  if (
    patch.enabled === true &&
    saved.enabled !== true &&
    next.mode === "macos" &&
    (await readPermission().catch(() => "unknown")) === "not-asked"
  ) {
    const permission = await requestAccessOnce();
    invalidatePermission();
    if (permission !== "granted") {
      return { ok: false, error: permissionErrorCode(permission) };
    }
  }
  if (next.enabled === true) {
    const error = await testCalendarRead(next);
    if (error !== null) return { ok: false, error };
  }
  patchSourceConfig("calendar", patch);
  invalidatePermission();
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
