import type {
  ArchivedGroupSummary,
  Card,
  UnwindDestination,
} from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Fetch a single card by id: GET /api/cards/:id.
 *
 * @remarks
 * Resolves `null` on a 400 (unknown id), so a card that has gone away reads distinctly from a
 * network failure, which still throws.
 */
export async function getCard(
  id: string,
): Promise<{ card: Card; members: Card[] } | null> {
  const result = await http<{ card: Card; members: Card[] }>(
    `/api/cards/${encodeURIComponent(id)}`,
  );
  if (result.status === 400) {
    return null;
  }
  if (!result.ok) {
    throw httpError("getCard", result);
  }
  return result.data;
}

/**
 * Unwind a group: POST /api/cards/:id/unwind with the members' destination.
 *
 * @remarks
 * `id` may be the group card or any member. A 200 gives the redacted archive summary, a 400, 404
 * or 409 gives the server's reason, and any other status throws.
 */
export async function unwindGroup(
  id: string,
  to: UnwindDestination,
): Promise<
  | { ok: true; archived: ArchivedGroupSummary }
  | { ok: false; status: number; error: string }
> {
  const result = await http<{ archived: ArchivedGroupSummary }>(
    `/api/cards/${encodeURIComponent(id)}/unwind`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    },
  );
  if (result.ok) {
    return { ok: true, archived: result.data.archived };
  }
  if (result.status === 400 || result.status === 404 || result.status === 409) {
    return {
      ok: false,
      status: result.status,
      error: result.error ?? "Couldn't unwind this group.",
    };
  }
  throw httpError("unwindGroup", result);
}
