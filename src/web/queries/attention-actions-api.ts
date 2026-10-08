import type { ReplyResult } from "../../shared/decision-view.js";
import type { BoardKey, DecisionItem } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

export type ActionOutcome =
  | { ok: true; result: ReplyResult | null }
  | { ok: false; error: string; reason: string | null };

/**
 * Fetch the open decisions of a board: GET /api/decisions?board=:key&state=open.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getOpenDecisions(
  board: BoardKey,
): Promise<DecisionItem[]> {
  const result = await http<{ items: DecisionItem[] }>(
    `/api/decisions?board=${encodeURIComponent(board)}&state=open`,
  );
  if (!result.ok) throw httpError("getOpenDecisions", result);
  return result.data.items;
}

/**
 * Send one user action as a JSON POST and resolve it as an outcome.
 *
 * @remarks
 * A refusal and a network failure both resolve as `ok: false`, so a caller handles one shape. `result` is null for the routes that answer no send result.
 */
export async function postAction(
  url: string,
  body?: unknown,
): Promise<ActionOutcome> {
  try {
    const result = await http<{ result?: ReplyResult } | null>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (result.ok) return { ok: true, result: result.data?.result ?? null };
    const reason = (result.body as { reason?: unknown } | null)?.reason;
    return {
      ok: false,
      error: result.error ?? `${result.status} ${result.statusText}`.trim(),
      reason: typeof reason === "string" ? reason : null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network error",
      reason: null,
    };
  }
}

/** Answer a decision with one of its options and an optional typed note: POST /api/decisions/:id/answer. */
export function answerDecision(
  id: string,
  optionId: string,
  note: string | null,
): Promise<ActionOutcome> {
  return postAction(
    `/api/decisions/${encodeURIComponent(id)}/answer`,
    note === null ? { optionId } : { optionId, note },
  );
}

/** Type into a loop session as the user: POST /api/sessions/:cardId/input. */
export function sendLoopInput(
  cardId: string,
  text: string,
): Promise<ActionOutcome> {
  return postAction(`/api/sessions/${encodeURIComponent(cardId)}/input`, {
    text,
  });
}

/** Resume a loop that waits at needs_input, as the user: POST /api/sessions/:cardId/resume-loop. */
export function resumeLoop(cardId: string): Promise<ActionOutcome> {
  return postAction(`/api/sessions/${encodeURIComponent(cardId)}/resume-loop`);
}
