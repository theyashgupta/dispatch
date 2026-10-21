import type { BoardKey, OrchestrationSummary } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

/** Fetch the orchestration summary of a board: GET /api/boards/:key/orchestration. */
export async function fetchOrchestrationSummary(
  board: BoardKey,
): Promise<OrchestrationSummary> {
  const result = await http<OrchestrationSummary>(
    `/api/boards/${encodeURIComponent(board)}/orchestration`,
  );
  if (!result.ok) throw httpError("fetchOrchestrationSummary", result);
  return result.data;
}
