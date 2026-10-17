import type { BoardKey, LinearComment } from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

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

type LinearActionResult =
  { ok: true } | { ok: false; status: number; error: string | null };

/**
 * POST a Linear action for a card and keep a failure as typed data.
 *
 * @remarks
 * A JSON body and its Content-Type go out only when `body` is given; assign-me sends neither.
 * `status` is 0 when the request never got an answer.
 */
async function linearAction(
  id: string,
  action: string,
  body?: object,
): Promise<LinearActionResult> {
  try {
    const result = await http(
      `/api/cards/${encodeURIComponent(id)}/${action}`,
      body === undefined
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    if (result.ok) return { ok: true };
    return { ok: false, status: result.status, error: result.error };
  } catch {
    return { ok: false, status: 0, error: null };
  }
}

/**
 * Post a Linear comment: POST /api/cards/:id/comment.
 *
 * @remarks
 * A 502 also sets the card's `linearError`, which arrives over SSE; `error` carries the
 * server's fixed copy, or null when the request never got an answer.
 */
export function postCardComment(
  id: string,
  body: string,
): Promise<LinearActionResult> {
  return linearAction(id, "comment", { body });
}

/** Assign a Linear card to the viewer: POST /api/cards/:id/assign-me. */
export function assignCardToMe(id: string): Promise<LinearActionResult> {
  return linearAction(id, "assign-me");
}

/** Move a Linear card to one of its team's states: POST /api/cards/:id/linear-state. */
export function setCardLinearState(
  id: string,
  stateId: string,
): Promise<LinearActionResult> {
  return linearAction(id, "linear-state", { stateId });
}

type SetBlockedByResult =
  | { ok: true }
  | { ok: false; status: number; error: string | null; reason: string | null };

/**
 * Replace a card's blockers: PUT /api/cards/:id/blocked-by.
 *
 * @remarks
 * A refusal resolves as typed data, with the server's `reason` read from the failure body.
 * `status` is 0 when the request never got an answer.
 */
export async function setCardBlockedBy(
  id: string,
  blockedBy: string[],
): Promise<SetBlockedByResult> {
  try {
    const result = await http(
      `/api/cards/${encodeURIComponent(id)}/blocked-by`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockedBy }),
      },
    );
    if (result.ok) return { ok: true };
    const reason = (result.body as { reason?: unknown } | null)?.reason;
    return {
      ok: false,
      status: result.status,
      error: result.error,
      reason: typeof reason === "string" ? reason : null,
    };
  } catch {
    return { ok: false, status: 0, error: null, reason: null };
  }
}

type SetCardOrchestratorResult =
  { ok: true } | { ok: false; status: number; error: string | null };

/**
 * Move a card to an orchestrator: PUT /api/boards/:board/cards/:id/orchestrator.
 *
 * @remarks
 * A refusal resolves as typed data, with the server's `error` code read from the failure body.
 * `status` is 0 when the request never got an answer.
 */
export async function setCardOrchestrator(
  board: BoardKey,
  id: string,
  orchestratorId: string,
): Promise<SetCardOrchestratorResult> {
  try {
    const result = await http(
      `/api/boards/${encodeURIComponent(board)}/cards/${encodeURIComponent(id)}/orchestrator`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orchestratorId }),
      },
    );
    if (result.ok) return { ok: true };
    return { ok: false, status: result.status, error: result.error };
  } catch {
    return { ok: false, status: 0, error: null };
  }
}
