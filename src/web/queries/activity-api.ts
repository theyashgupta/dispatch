import { withBoard } from "../../shared/board-select.js";
import type { ActivityEvent, BoardKey } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Read the newest-first event log: GET /api/events with optional `cardId` and `limit` query params.
 *
 * @remarks
 * Throws on any non-2xx so the caller can decide, and the feed keeps its last-known buffer on
 * failure.
 */
export async function fetchEvents(
  board: BoardKey,
  cardId?: string,
  limit?: number,
): Promise<ActivityEvent[]> {
  const params = new URLSearchParams();
  if (cardId !== undefined) params.set("cardId", cardId);
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  const result = await http<{ events: ActivityEvent[] }>(
    withBoard(`/api/events${query ? `?${query}` : ""}`, board),
  );
  if (!result.ok) {
    throw httpError("fetchEvents", result);
  }
  return result.data.events;
}
