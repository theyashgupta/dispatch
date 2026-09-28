import type { CalendarSourceConfig, Config } from "../../shared/types.js";
import {
  DEFAULT_FILTERS,
  DEFAULT_POLL_INTERVAL_MS,
} from "../../shared/types.js";
import type { TicketSource } from "./ticket.source.js";
import { LinearSource } from "./linear/linear.source.js";
import {
  CALENDAR_POLL_INTERVAL_MS,
  CalendarSource,
  type CredentialResolver,
  type MacCalendarReader,
} from "./calendar/calendar.source.js";

/** The boot-built ticket sources, keyed by id. Empty until buildRegistry() runs at boot. */
const sources = new Map<string, TicketSource>();

const enabled = new Set<string>();

const credentialResolvers = new Map<string, CredentialResolver>();

let macCalendarReader: MacCalendarReader | undefined;

/**
 * Register how a source reads its secret from the Vault; boot calls this before buildRegistry.
 *
 * @remarks Sources may not import services, so the Vault read is handed in (G5 U1-01's name).
 */
export function setCredentialResolver(
  sourceId: string,
  resolve: CredentialResolver,
): void {
  credentialResolvers.set(sourceId, resolve);
}

/** Register the macOS Calendar reader (the osascript adapter); boot calls this before buildRegistry. */
export function setMacCalendarReader(read: MacCalendarReader): void {
  macCalendarReader = read;
}

/**
 * Construct every known source from config and record which ones are enabled.
 *
 * @remarks Every source object is built even when disabled, because the filter and options routes
 * need the Linear object with an empty key; only the poll loop consults the enabled set. The Linear
 * source reads filters through a live accessor over the SAME `config` object, which
 * `updateSourceFilters` mutates in place, so a settings save is visible to the next poll.
 */
export function buildRegistry(config: Config): void {
  sources.clear();
  enabled.clear();
  const linearConfig = config.sources?.linear;
  const linear = new LinearSource(
    config.linearApiKey,
    () => linearConfig?.filters ?? DEFAULT_FILTERS,
    linearConfig?.pollIntervalMs ??
      config.pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS,
  );
  sources.set(linear.id, linear);
  if (linearConfig?.enabled !== false && config.linearApiKey !== "") {
    enabled.add(linear.id);
  }
  const calendar = calendarSourceFor(
    () => config.sources?.calendar ?? { mode: "macos" },
  );
  sources.set(calendar.id, calendar);
  if (config.sources?.calendar?.enabled === true) enabled.add(calendar.id);
}

/**
 * A calendar source over the given settings with the boot-injected readers.
 *
 * @remarks The settings route builds a throwaway one to run the test read before it saves.
 */
export function calendarSourceFor(
  settings: () => CalendarSourceConfig,
): CalendarSource {
  return new CalendarSource(
    settings,
    {
      mac: () => macCalendarReader,
      resolveIcalUrl: () =>
        credentialResolvers.get("calendar")?.() ?? Promise.resolve(null),
    },
    settings().pollIntervalMs ?? CALENDAR_POLL_INTERVAL_MS,
  );
}

export function getSource(id: string): TicketSource | undefined {
  return sources.get(id);
}

export function listSources(): TicketSource[] {
  return [...sources.values()];
}

export function isSourceEnabled(id: string): boolean {
  return enabled.has(id);
}

/** The sources the poll loop should run, in registration order. */
export function enabledSources(): TicketSource[] {
  return listSources().filter((s) => enabled.has(s.id));
}

/** The single Linear source; throws if buildRegistry() has not run (a boot-order bug). */
export function getLinearSource(): TicketSource {
  const linear = getSource("linear");
  if (!linear) {
    throw new Error(
      "linear source not built, buildRegistry() must run at boot",
    );
  }
  return linear;
}
