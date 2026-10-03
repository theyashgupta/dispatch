import type {
  GranolaCheckResult,
  GRANOLA_WINDOW_HOURS,
} from "../../../../shared/types.js";
import { GRANOLA_ERROR_COPY } from "../../../../shared/connection-status.js";

export type GranolaWindowKey = `${(typeof GRANOLA_WINDOW_HOURS)[number]}`;

export const GRANOLA_WINDOW_LABELS: Record<GranolaWindowKey, string> = {
  "24": "Last 24 hours",
  "48": "Last 48 hours",
  "72": "Last 3 days",
  "168": "Last 7 days",
  "336": "Last 14 days",
};

export const GRANOLA_POLL_MS = 5_000;

/**
 * Decide how often the Granola status is re-read.
 *
 * @remarks Only a running round polls, so an idle Settings page makes no background requests.
 */
export function granolaPollInterval(
  status: { running?: boolean } | null | undefined,
): number | false {
  return status?.running === true ? GRANOLA_POLL_MS : false;
}

/** The line under the buttons for a Check connection result, or none before one ran. */
export function granolaCheckLine(
  check: GranolaCheckResult | null,
): string | null {
  if (check === null) return null;
  return check.state === "connected"
    ? `Connected: ${check.server}`
    : GRANOLA_ERROR_COPY[check.state];
}
