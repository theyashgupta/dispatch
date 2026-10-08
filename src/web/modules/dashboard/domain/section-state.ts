import { clock } from "./usage-meters.js";

export type SectionState =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

interface QueryRead {
  data: unknown;
  error: Error | null;
}

/**
 * Maps the queries that feed one section to its display state.
 *
 * @remarks A query with data counts as ready even when a refetch failed, so the last data stays on
 * screen. An error wins over loading, so one failed input shows the alert and not a skeleton.
 */
export function sectionState(queries: readonly QueryRead[]): SectionState {
  const failed = queries.find((q) => q.data === undefined && q.error !== null);
  if (failed?.error != null) {
    return { kind: "error", message: failed.error.message };
  }
  return queries.some((q) => q.data === undefined)
    ? { kind: "loading" }
    : { kind: "ready" };
}

/** Builds the stale badge text "Data from 12:41", or null while the stream is connected. */
export function staleBadgeText(
  connection: "connecting" | "connected" | "disconnected",
  updatedAt: number,
  timeZone?: string,
): string | null {
  if (connection !== "disconnected" || updatedAt === 0) return null;
  return `Data from ${clock(new Date(updatedAt).toISOString(), timeZone, false)}`;
}
