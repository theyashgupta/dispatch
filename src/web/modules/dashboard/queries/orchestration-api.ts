import type {
  BoardKey,
  OrchestrationEvent,
  OrchestrationSummary,
} from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";
import {
  postAction,
  type ActionOutcome,
} from "@/queries/attention-actions-api";

export interface OrchestrationEventsParams {
  since?: number;
  limit?: number;
}

const boardPath = (board: BoardKey) =>
  `/api/boards/${encodeURIComponent(board)}`;

/** Fetch the orchestration summary of a board: GET /api/boards/:key/orchestration. */
export async function fetchOrchestrationSummary(
  board: BoardKey,
): Promise<OrchestrationSummary> {
  const result = await http<OrchestrationSummary>(
    `${boardPath(board)}/orchestration`,
  );
  if (!result.ok) throw httpError("fetchOrchestrationSummary", result);
  return result.data;
}

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

/** Try the resume of a dead session again: POST /api/cards/:id/resume. */
export function retryResume(cardId: string): Promise<ActionOutcome> {
  return postAction(`/api/cards/${encodeURIComponent(cardId)}/resume`, {});
}
