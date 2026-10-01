import type { CardSearchResult } from "../../shared/search.js";
import { http, httpError } from "@/lib/http";

/**
 * Search every card on the board, including ones outside the client's loaded window: GET /api/search?q=.
 *
 * @remarks
 * The caller's `AbortController` cancels a request superseded by a newer keystroke, and an abort
 * rejects with `AbortError` for the caller's catch to ignore. Throws on any non-2xx.
 */
export async function searchCards(
  q: string,
  signal?: AbortSignal,
): Promise<{ results: CardSearchResult[]; total: number }> {
  const result = await http<{ results: CardSearchResult[]; total: number }>(
    `/api/search?q=${encodeURIComponent(q)}`,
    { signal },
  );
  if (!result.ok) {
    throw httpError("searchCards", result);
  }
  return result.data;
}
