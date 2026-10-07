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

export type StartResult =
  { ok: true } | { ok: false; error: string; variant?: string };

/**
 * Starts a card's session: POST /api/cards/:id/start.
 *
 * @remarks
 * A 202 resolves `{ ok: true }`, a 400 resolves `{ ok: false, error, variant }` from the parsed
 * body (variant `config` or `playbook`), and any other status throws. Each optional argument
 * reaches the body only when the caller supplies it (`newSession` only when `true`), so the
 * request stays byte-identical for callers that do not opt in.
 */
export async function startCard(
  id: string,
  extraDirection: string,
  folder?: string,
  repos?: { path: string; base: string }[],
  playbook?: string,
  newSession?: boolean,
  inheritFrom?: string,
): Promise<StartResult> {
  const body = {
    extraDirection,
    folder,
    repos,
    playbook,
    newSession: newSession === true ? true : undefined,
    inheritFrom,
  };
  const result = await http(`/api/cards/${encodeURIComponent(id)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (result.ok) {
    return { ok: true };
  }
  if (result.status === 400) {
    const failure = (result.body ?? {}) as {
      error?: string;
      variant?: string;
    };
    return {
      ok: false,
      error: failure.error ?? "Start failed.",
      variant: failure.variant,
    };
  }
  throw httpError("startCard", result);
}

export type StartGroupResult =
  | { ok: true; card: Card }
  | {
      ok: false;
      error: string;
      variant?: "config" | "playbook" | "ineligible";
      ineligibleIds?: string[];
    };

/**
 * Creates and starts a multi-ticket group in one request: POST /api/cards/group.
 *
 * @remarks
 * A 202 carries the new `card`, a 400 resolves the error with its `config` or `playbook` variant,
 * and a 409 resolves the server's re-validated `ineligibleIds`, because the server is the source
 * of truth for eligibility. Any other status throws.
 */
export async function startGroup(input: {
  title: string;
  memberIds: string[];
  folder: string;
  repos: { path: string; base: string }[];
  playbook?: string;
  extraDirection?: string;
}): Promise<StartGroupResult> {
  const result = await http<{ card: Card }>("/api/cards/group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (result.ok && result.status === 202) {
    return { ok: true, card: result.data.card };
  }
  if (!result.ok && result.status === 400) {
    const failure = (result.body ?? {}) as {
      error?: string;
      variant?: string;
    };
    return {
      ok: false,
      error: failure.error ?? "Start failed.",
      variant:
        failure.variant === "config" || failure.variant === "playbook"
          ? failure.variant
          : undefined,
    };
  }
  if (!result.ok && result.status === 409) {
    const failure = (result.body ?? {}) as {
      error?: string;
      ineligibleIds?: string[];
    };
    return {
      ok: false,
      error: failure.error ?? "Some selected tickets are no longer eligible.",
      variant: "ineligible",
      ineligibleIds: failure.ineligibleIds ?? [],
    };
  }
  throw new Error(
    `startGroup failed: ${result.status} ${result.ok ? "" : result.statusText}`,
  );
}

/**
 * Promote a local card to a Linear issue: POST /api/cards/:id/sync-linear.
 *
 * @remarks
 * 200 carries the adopted card; 400 and 409 carry renderable copy; any other failure
 * answers `error: null`, and the card's `syncError` arrives over SSE.
 */
export async function syncCardToLinear(
  id: string,
  target: { teamId: string; stateId?: string },
): Promise<{ ok: true; card: Card } | { ok: false; error: string | null }> {
  try {
    const result = await http<Card>(
      `/api/cards/${encodeURIComponent(id)}/sync-linear`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      },
    );
    if (result.ok) return { ok: true, card: result.data };
    if (result.status === 400 || result.status === 409) {
      return { ok: false, error: result.error };
    }
    return { ok: false, error: null };
  } catch {
    return { ok: false, error: null };
  }
}

/**
 * Generate a local ticket draft via headless `claude -p`: POST /api/cards/draft.
 *
 * @remarks
 * Non-OK statuses (400, 409, 502) resolve `{ ok: false }`. An abort or network failure rejects and
 * is deliberately not caught here, so the caller can tell a user abort (`AbortError`) from every
 * other failure.
 */
export async function generateTicketDraft(
  direction: string,
  signal: AbortSignal,
  images: readonly string[] = [],
): Promise<{ ok: true; title: string; description: string } | { ok: false }> {
  const result = await http<{ title: string; description: string }>(
    "/api/cards/draft",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction, images }),
      signal,
    },
  );
  if (!result.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    title: result.data.title,
    description: result.data.description,
  };
}

/**
 * Generate a group card title phrase via headless `claude -p`: POST /api/cards/group-title.
 *
 * @remarks
 * Non-OK statuses (400, 409, 502) resolve `{ ok: false }`, and an abort or network failure rejects
 * for the caller's catch, like `generateTicketDraft`.
 */
export async function generateGroupTitle(
  memberIds: string[],
  signal: AbortSignal,
): Promise<{ ok: true; phrase: string } | { ok: false }> {
  const result = await http<{ phrase: string }>("/api/cards/group-title", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberIds }),
    signal,
  });
  if (!result.ok) {
    return { ok: false };
  }
  return { ok: true, phrase: result.data.phrase };
}

/**
 * Offer a Done card's workspace cleanup: POST /api/cards/:id/cleanup.
 *
 * @remarks
 * The client sends only the card id and a `force` flag, because every path and session is server-
 * derived. `force: true` bypasses the dirty-worktree preflight and discards uncommitted work
 * (PRE-02). Throws on any non-2xx.
 */
export async function cleanupCard(id: string, force = false): Promise<void> {
  const result = await http(`/api/cards/${encodeURIComponent(id)}/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  if (!result.ok) {
    throw httpError("cleanupCard", result);
  }
}

/**
 * Reset a started ticket: POST /api/cards/:id/reset.
 *
 * @remarks
 * A 200 means the card is back in the Inbox. Any JSON error body is returned as a refusal with the
 * server's reason, and a response without one throws.
 */
export async function resetCard(
  id: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const result = await http(`/api/cards/${encodeURIComponent(id)}/reset`, {
    method: "POST",
  });
  if (result.ok) return { ok: true };
  const body = result.body as {
    error?: string;
  } | null;
  if (body?.error)
    return { ok: false, status: result.status, error: body.error };
  throw httpError("resetCard", result);
}

export type ResumeResult = { ok: true } | { ok: false; status: number | null };

/**
 * Resume a dead In Review session: POST /api/cards/:id/resume.
 *
 * @remarks
 * Resolves `{ ok: true }` on 2xx and `{ ok: false, status }` on a non-2xx so the caller can tell a
 * 409 conflict from other failures, with `status` null on a network failure. The client sends only
 * the card id, because the worktree path is server-owned.
 */
export async function resumeCard(id: string): Promise<ResumeResult> {
  try {
    const result = await http(`/api/cards/${encodeURIComponent(id)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (result.ok) {
      return { ok: true };
    }
    return { ok: false, status: result.status };
  } catch {
    return { ok: false, status: null };
  }
}
