import type {
  CalendarSourceConfig,
  CalendarStatus,
  FilterCapabilities,
  FilterOption,
  Item,
  SourceIssue,
} from "../../../shared/types.js";
import type { TicketSource } from "../ticket.source.js";
import {
  CalendarReadError,
  calendarErrorCode,
  eventToItem,
  type CalendarEvent,
} from "./calendar-events.js";
import { parseIcs } from "./ics.js";

export type MacCalendarReader = (
  from: Date,
  to: Date,
  calendars: readonly string[],
) => Promise<{ events: CalendarEvent[]; partial: boolean }>;

export type CredentialResolver = () => Promise<string | null>;

export interface CalendarReaders {
  mac: () => MacCalendarReader | undefined;
  resolveIcalUrl: CredentialResolver;
}

export type CalendarSourceStatus = Pick<
  CalendarStatus,
  "lastPolledAt" | "lastError" | "eventCount"
>;

export const CALENDAR_POLL_INTERVAL_MS = 300_000;
const HOUR_MS = 3_600_000;
const ICAL_TIMEOUT_MS = 30_000;
const ICAL_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/**
 * Parse the iCal URL and allow https, or http to a loopback host when `loopbackHttp` is set.
 */
function icalUrl(raw: string, loopbackHttp = true): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CalendarReadError("ical-url-invalid");
  }
  const allowed =
    url.protocol === "https:" ||
    (loopbackHttp &&
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname));
  if (!allowed || url.username !== "" || url.password !== "") {
    throw new CalendarReadError("ical-url-invalid");
  }
  return url;
}

/**
 * Download an iCal document with a 30 s deadline, stopping at 5 MB.
 *
 * @remarks Redirects are followed by hand so every hop passes the https rule, and a loopback http hop
 * only when the configured URL is itself loopback, so a remote feed cannot aim Dispatch at a local
 * service. Every failure becomes a code: the URL is a secret and never reaches an error or a log.
 */
async function fetchIcal(url: URL): Promise<string> {
  const signal = AbortSignal.timeout(ICAL_TIMEOUT_MS);
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  let current = url;
  let res: Response;
  for (let hop = 0; ; hop += 1) {
    try {
      res = await fetch(current, { redirect: "manual", signal });
    } catch {
      throw new CalendarReadError(
        signal.aborted ? "timeout" : "ical-unreachable",
      );
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || location === null) break;
    await res.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new CalendarReadError("ical-unreachable");
    current = icalUrl(new URL(location, current).href, loopback);
  }
  if (!res.ok || res.body === null) {
    await res.body?.cancel();
    throw new CalendarReadError("ical-unreachable");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ICAL_MAX_BYTES) {
        await reader.cancel();
        throw new CalendarReadError("ical-too-large");
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof CalendarReadError) throw err;
    throw new CalendarReadError(
      signal.aborted ? "timeout" : "ical-unreachable",
    );
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new CalendarReadError("ical-invalid");
  }
  return text;
}

/**
 * The calendar snapshot source: events from one hour ago to 48 hours ahead, as items.
 *
 * @remarks Sources may import only sources and shared, so the macOS reader and the Vault resolver
 * arrive as injected lookups (R-18). The last read's outcome stays in memory for the status route.
 */
export class CalendarSource implements TicketSource {
  readonly id = "calendar";
  readonly kind = "snapshot" as const;
  readonly itemsOnly = true;
  readonly vaultKeys = ["CALENDAR_ICAL_URL"] as const;
  readonly capabilities: FilterCapabilities = { dimensions: [] };
  status: CalendarSourceStatus = {};

  /** Build the source over live settings, injected readers and a clock the tests can pin. */
  constructor(
    private readonly settings: () => CalendarSourceConfig,
    private readonly readers: CalendarReaders,
    readonly pollIntervalMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** No filter dimensions: every event in the window is listed. */
  listOptions(): Promise<{ options: FilterOption[]; truncated: boolean }> {
    return Promise.resolve({ options: [], truncated: false });
  }

  /** No filter dimensions, so there is nothing to count. */
  countMatches(): Promise<{ count: number; more: boolean }> {
    return Promise.resolve({ count: 0, more: false });
  }

  private async readEvents(
    from: Date,
    to: Date,
  ): Promise<{ events: CalendarEvent[]; partial: boolean }> {
    const settings = this.settings();
    if (settings.mode === "ical") {
      const raw = await this.readers.resolveIcalUrl();
      if (raw === null || raw.trim() === "") {
        throw new CalendarReadError("ical-url-missing");
      }
      return parseIcs(await fetchIcal(icalUrl(raw)), from, to);
    }
    const mac = this.readers.mac();
    if (mac === undefined) throw new CalendarReadError("failed");
    return mac(from, to, settings.calendars ?? []);
  }

  /**
   * Read the window and map it to items, recording the outcome for the status route.
   *
   * @remarks A failure is rethrown as its code so the poller keeps the last good items (U4-08).
   */
  async fetch(): Promise<{
    issues: SourceIssue[];
    items: Item[];
    truncated: boolean;
  }> {
    const now = this.now();
    const polledAt = now.toISOString();
    try {
      const { events, partial } = await this.readEvents(
        new Date(now.getTime() - HOUR_MS),
        new Date(now.getTime() + 48 * HOUR_MS),
      );
      const items = events.map((event) => eventToItem(event, now));
      this.status = { lastPolledAt: polledAt, eventCount: items.length };
      return { issues: [], items, truncated: partial };
    } catch (err) {
      const code = calendarErrorCode(err);
      this.status = { ...this.status, lastPolledAt: polledAt, lastError: code };
      throw new CalendarReadError(code);
    }
  }
}
