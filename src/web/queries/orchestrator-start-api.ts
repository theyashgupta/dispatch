import type { BoardKey } from "../../shared/types.js";
import { actionFailedText, refusalText } from "../../shared/decision-view.js";
import { http } from "@/lib/http";

const JSON_HEADERS = { "Content-Type": "application/json" };
const ACTION = "Start orchestrator";

type Step = { ok: true } | { ok: false; code: string | null; error: string };

async function post(url: string, init: RequestInit): Promise<Step> {
  try {
    const result = await http<unknown>(url, { method: "POST", ...init });
    if (result.ok) return { ok: true };
    const reason = (result.body as { reason?: unknown } | null)?.reason;
    return {
      ok: false,
      code: result.error,
      error: actionFailedText(
        ACTION,
        refusalText(result.error, typeof reason === "string" ? reason : null),
      ),
    };
  } catch (err) {
    return {
      ok: false,
      code: null,
      error: actionFailedText(
        ACTION,
        err instanceof Error ? err.message : "the request failed",
      ),
    };
  }
}

/**
 * Add the main orchestrator record when the board has none, then start it.
 *
 * @remarks A refused add stops the sequence, so a board never gets a start call without a record. A duplicate-id refusal means the record exists and the cached list was stale, so the start call still runs.
 */
export async function startMainOrchestrator(
  board: BoardKey,
  hasMainRecord: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = `/api/boards/${encodeURIComponent(board)}/orchestrators`;
  if (!hasMainRecord) {
    const added = await post(base, {
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: "main",
        name: "Main orchestrator",
        role: "main",
      }),
    });
    if (!added.ok && added.code !== "duplicate-id") {
      return { ok: false, error: added.error };
    }
  }
  const started = await post(`${base}/main/start`, { headers: JSON_HEADERS });
  return started.ok ? { ok: true } : { ok: false, error: started.error };
}
