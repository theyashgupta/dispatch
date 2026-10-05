import type {
  ArchivedGroupSummary,
  Card,
  Column,
  LinearComment,
  UnwindDestination,
} from "../../../../shared/types.js";
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
 * Ensure a ttyd terminal for a card's live session: POST /api/cards/:id/terminal.
 *
 * @remarks
 * The backend spawns or reuses ttyd single-flight and answers 202, and the SSE snapshot carries
 * the outcome, so there is no response body to parse. Throws on any non-2xx.
 */
export async function ensureTerminal(id: string): Promise<void> {
  const result = await http(`/api/cards/${encodeURIComponent(id)}/terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!result.ok) {
    throw httpError("ensureTerminal", result);
  }
}

/**
 * Relaunch claude inside a card's live shell session: POST /api/cards/:id/run-claude.
 *
 * @remarks
 * Answers 202 with no body, since the terminal itself shows the launch. A 409 means the pane is
 * not at its shell prompt and the server typed nothing, and any non-2xx throws.
 */
export async function runClaude(id: string): Promise<void> {
  const result = await http(`/api/cards/${encodeURIComponent(id)}/run-claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!result.ok) {
    throw httpError("runClaude", result);
  }
}

/**
 * Move a card's active pointer to a sibling session: POST /api/cards/:id/session.
 *
 * @remarks
 * The store's single-writer switch runs server-side and the SSE snapshot carries the outcome, so
 * there is no response body to parse. The switcher's optimistic highlight is local state
 * reconciled by the next broadcast, and this call does not drive it. Throws on any non-2xx.
 */
export async function switchSession(
  cardId: string,
  sessionId: string,
): Promise<void> {
  const result = await http(
    `/api/cards/${encodeURIComponent(cardId)}/session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    },
  );
  if (!result.ok) {
    throw httpError("switchSession", result);
  }
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

/**
 * Open a card's workspace folder in VS Code or Cursor: POST /api/cards/:id/open-editor.
 *
 * @remarks
 * Sends only the `editor` discriminant, because the server reads the path from
 * `card.workspacePath`, never from the client. Answers 204 and throws on any non-2xx.
 */
export async function openEditor(
  id: string,
  editor: "code" | "cursor",
): Promise<void> {
  const result = await http(
    `/api/cards/${encodeURIComponent(id)}/open-editor`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editor }),
    },
  );
  if (!result.ok) {
    throw httpError("openEditor", result);
  }
}

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
 * The stored Linear comments of a card, oldest first: GET /api/cards/:id/comments.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getCardComments(id: string): Promise<LinearComment[]> {
  const result = await http<{ comments: LinearComment[] }>(
    `/api/cards/${encodeURIComponent(id)}/comments`,
  );
  if (!result.ok) {
    throw httpError("getCardComments", result);
  }
  return result.data.comments;
}

/**
 * Post a Linear comment: POST /api/cards/:id/comment.
 *
 * @remarks
 * A 502 also sets the card's `linearError`, which arrives over SSE; `error` carries the
 * server's fixed copy, or null when the request never got an answer.
 */
export async function postCardComment(
  id: string,
  body: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string | null }> {
  try {
    const result = await http(`/api/cards/${encodeURIComponent(id)}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (result.ok) return { ok: true };
    return { ok: false, status: result.status, error: result.error };
  } catch {
    return { ok: false, status: 0, error: null };
  }
}

/** Assign a Linear card to the viewer: POST /api/cards/:id/assign-me. */
export async function assignCardToMe(
  id: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string | null }> {
  try {
    const result = await http(
      `/api/cards/${encodeURIComponent(id)}/assign-me`,
      {
        method: "POST",
      },
    );
    if (result.ok) return { ok: true };
    return { ok: false, status: result.status, error: result.error };
  } catch {
    return { ok: false, status: 0, error: null };
  }
}

/** Move a Linear card to one of its team's states: POST /api/cards/:id/linear-state. */
export async function setCardLinearState(
  id: string,
  stateId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string | null }> {
  try {
    const result = await http(
      `/api/cards/${encodeURIComponent(id)}/linear-state`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId }),
      },
    );
    if (result.ok) return { ok: true };
    return { ok: false, status: result.status, error: result.error };
  } catch {
    return { ok: false, status: 0, error: null };
  }
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

/**
 * Draft the user's action items from meeting notes: POST /api/cards/draft-many.
 *
 * @remarks
 * Non-OK statuses resolve `{ ok: false, error }` with the server's error code; an abort
 * or a network failure rejects, left for the caller's catch, like `generateTicketDraft`.
 */
export async function draftMeetingItems(
  meeting: string,
  notes: string,
  me: string,
  signal: AbortSignal,
): Promise<
  | {
      ok: true;
      drafts: { key: string; title: string; description: string }[];
    }
  | { ok: false; error: string | null }
> {
  const result = await http<{
    drafts: { key: string; title: string; description: string }[];
  }>("/api/cards/draft-many", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meeting, notes, me }),
    signal,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, drafts: result.data.drafts };
}
