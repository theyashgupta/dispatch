import type {
  ArchivedGroupSummary,
  Card,
  LinearComment,
  UnwindDestination,
} from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

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
  const body =
    folder !== undefined || repos !== undefined
      ? {
          extraDirection,
          folder,
          repos,
          playbook,
          newSession: newSession === true ? true : undefined,
          inheritFrom,
        }
      : {
          extraDirection,
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
