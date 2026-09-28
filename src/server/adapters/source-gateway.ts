import {
  buildRegistry,
  calendarSourceFor,
  getLinearSource,
  getSource,
  isSourceEnabled,
  listSources,
} from "../sources/registry.js";
import {
  fetchLinearAccount,
  testLinearConnection as testImpl,
} from "../sources/linear/linear.source.js";
import type {
  FilterCapabilities,
  FilterDimension,
  FilterOption,
  TicketSource,
} from "../sources/ticket.source.js";
import {
  CalendarSource,
  type CalendarSourceStatus,
} from "../sources/calendar/calendar.source.js";
import { calendarErrorCode } from "../sources/calendar/calendar-events.js";
import type {
  CalendarErrorCode,
  CalendarSourceConfig,
  Config,
  SourceFilters,
} from "../../shared/types.js";

export {
  setCredentialResolver,
  setMacCalendarReader,
} from "../sources/registry.js";

/**
 * Thrown when a route asks for a source id the registry does not serve. It lives in the adapters
 * layer so routes can map it to a 404 without importing `sources` directly — the eslint boundary
 * forbids routes from reaching into `sources`, so this gateway is the only seam between them.
 */
export class SourceNotFound extends Error {
  constructor(sourceId: string) {
    super(`unknown source: ${sourceId}`);
    this.name = "SourceNotFound";
  }
}

/**
 * Resolve a source id to its TicketSource. Only `linear` exists today; anything else is a
 * SourceNotFound the route turns into a 404, keeping the not-found decision out of the routes layer.
 */
function resolveSource(sourceId: string): TicketSource {
  if (sourceId !== "linear") {
    throw new SourceNotFound(sourceId);
  }
  return getLinearSource();
}

/** The source's static filter surface — the dimensions the settings UI is allowed to render. */
export function getSourceCapabilities(sourceId: string): FilterCapabilities {
  return resolveSource(sourceId).capabilities;
}

/** Live workspace options for a multi-select dimension (users/teams/projects), fetched on demand. */
export function listSourceOptions(
  sourceId: string,
  dimension: Exclude<FilterDimension, "cycle">,
): Promise<{ options: FilterOption[]; truncated: boolean }> {
  return resolveSource(sourceId).listOptions(dimension);
}

/** Match count for a candidate filter set, routed through the poll's own builder (preview == reality). */
export function countSourceMatches(
  sourceId: string,
  filters: SourceFilters,
): Promise<{ count: number; more: boolean }> {
  return resolveSource(sourceId).countMatches(filters);
}

/**
 * Rebuild the source registry from a (now key-carrying) config — the seam the first-run setup route
 * uses to swap the keyless registry for one that can poll, without importing `sources` directly.
 */
export function rebuildSources(config: Config): void {
  buildRegistry(config);
}

/** Live Linear key check for the setup route (viewer query); the only seam routes may reach it through. */
export function testLinearConnection(apiKey: string): Promise<boolean> {
  return testImpl(apiKey);
}

/**
 * Check a key live and return its account, or null when the source rejects it.
 *
 * @remarks Re-throws every failure that is not a credential rejection so the route can answer
 * unreachable.
 */
export function checkSourceKey(
  sourceId: string,
  apiKey: string,
): Promise<{ account?: string } | null> {
  resolveSource(sourceId);
  return fetchLinearAccount(apiKey);
}

/** Whether a source id is registered and enabled, for routes that must answer 404 or 409. */
export function sourceState(
  sourceId: string,
): "enabled" | "disabled" | "unknown" {
  if (!getSource(sourceId)) return "unknown";
  return isSourceEnabled(sourceId) ? "enabled" : "disabled";
}

/** Ids of the sources that declare a vault key name, for the Vault page's "Used by" line. */
export function vaultKeyUsers(
  name: string,
  sources: readonly TicketSource[] = listSources(),
): string[] {
  return sources.filter((s) => s.vaultKeys.includes(name)).map((s) => s.id);
}

/**
 * Run one calendar read with candidate settings; the error code on failure, null on success.
 *
 * @remarks The read uses a throwaway source, so nothing reaches the store before the user's
 * settings are saved (U4-09).
 */
export async function testCalendarRead(
  settings: CalendarSourceConfig,
): Promise<CalendarErrorCode | null> {
  try {
    await calendarSourceFor(() => settings).fetch();
    return null;
  } catch (err) {
    return calendarErrorCode(err);
  }
}

/** The registered calendar source's last read outcome, empty before its first read. */
export function calendarReadStatus(): CalendarSourceStatus {
  const source = getSource("calendar");
  return source instanceof CalendarSource ? source.status : {};
}
