import type { Card, Column } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Move a card to a column: POST /api/cards/:id/move.
 *
 * @remarks
 * The SSE snapshot reconciles the authoritative state, so callers treat it as fire-and-forget.
 * Rejects on non-2xx so callers can log or roll back.
 */
export async function moveCard(id: string, column: Column): Promise<void> {
  const result = await http(`/api/cards/${encodeURIComponent(id)}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column }),
  });
  if (!result.ok) {
    throw httpError("moveCard", result);
  }
}

/**
 * Persist a reviewed ticket draft: POST /api/cards.
 *
 * @remarks
 * The server mints the `LOCAL-<n>` identifier and re-validates title and description including the
 * DISPATCH_STATUS footgun guard, so the client's draft is never trusted. A 201 resolves the
 * created `Card`, a validation 400 resolves the parsed `{ error }` code, and network failures and
 * every other status resolve `{ ok: false, error: null }`.
 */
export async function createLocalTicket(
  title: string,
  description: string,
  images: readonly string[] = [],
): Promise<{ ok: true; card: Card } | { ok: false; error: string | null }> {
  try {
    const result = await http<Card>("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, images }),
    });
    if (!result.ok) {
      if (result.status === 400) {
        return { ok: false, error: result.error };
      }
      return { ok: false, error: null };
    }
    return { ok: true, card: result.data };
  } catch {
    return { ok: false, error: null };
  }
}
