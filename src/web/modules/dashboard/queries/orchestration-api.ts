import type { BoardKey, OrchestrationEvent } from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

export interface OrchestrationEventsParams {
  since?: number;
  limit?: number;
}

const boardPath = (board: BoardKey) =>
  `/api/boards/${encodeURIComponent(board)}`;

/**
 * Fetch orchestration events of a board: GET /api/boards/:key/orchestration/events.
 *
 * @remarks Without `since` the newest events come first. With `since` the later events come oldest first.
 */
export async function fetchOrchestrationEvents(
  board: BoardKey,
  params: OrchestrationEventsParams = {},
): Promise<OrchestrationEvent[]> {
  const query = new URLSearchParams();
  if (params.since !== undefined) query.set("since", String(params.since));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const result = await http<{ events: OrchestrationEvent[] }>(
    `${boardPath(board)}/orchestration/events${suffix}`,
  );
  if (!result.ok) throw httpError("fetchOrchestrationEvents", result);
  return result.data.events;
}
