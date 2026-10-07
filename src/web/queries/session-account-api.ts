import { http } from "@/lib/http";
import type { MoveSessionAccountResult } from "../../shared/session-account-view.js";

const MESSAGES: Record<string, string> = {
  "not-found": "That card or account no longer exists.",
  "no-session": "This card has no live session to move.",
  legacy: "This session predates account tracking and cannot move.",
  "limit-unknown":
    "Dispatch found no safe way to leave the usage limit screen. Try again after the limit clears.",
};

function refusal(error: string): MoveSessionAccountResult {
  return {
    ok: false,
    error,
    message: MESSAGES[error] ?? "Couldn't move the session.",
  };
}

/**
 * Move a card's session onto an account: POST /api/cards/:id/session/account.
 *
 * @remarks
 * A refusal resolves `{ ok: false, error, message }` with a human message per code and never
 * throws. 202 means the session is busy and moves when its turn ends. The restart of a stale
 * session is the same call with the session's own account id.
 */
export async function moveSessionAccount(
  cardId: string,
  accountId: string,
  sessionId?: string,
): Promise<MoveSessionAccountResult> {
  const result = await http<{ outcome?: string } | null>(
    `/api/cards/${encodeURIComponent(cardId)}/session/account`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        sessionId === undefined ? { accountId } : { accountId, sessionId },
      ),
    },
  );
  if (!result.ok) {
    if (result.status === 404) return refusal("not-found");
    if (result.status === 409 && result.error !== null) {
      return refusal(result.error);
    }
    return refusal(result.status === 409 ? "conflict" : "failed");
  }
  if (result.data?.outcome === "queued") {
    return { ok: true, outcome: "queued" };
  }
  return {
    ok: true,
    outcome: result.data?.outcome === "same" ? "same" : "moved",
  };
}
