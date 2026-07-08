import type { Column } from "../../shared/types.js";

/**
 * Optimistically move a card to a column: POST /api/cards/:id/move.
 * Fire-and-forget from the caller's perspective — the SSE snapshot reconciles
 * the authoritative state. Rejects on non-2xx so callers can log/rollback.
 */
export async function moveCard(id: string, column: Column): Promise<void> {
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column }),
  });
  if (!res.ok) {
    throw new Error(`moveCard failed: ${res.status} ${res.statusText}`);
  }
}

/** Discriminated result of a start request. */
export type StartResult =
  { ok: true } | { ok: false; error: string; variant?: string };

/**
 * Request a session start for a card: POST /api/cards/:id/start.
 * The backend route lands in a later plan (wave 3); the frozen contract is
 * 202 { started: true } on success and 400 { error, variant? } for a validation
 * failure (e.g. missing repo config). 2xx → { ok: true }; 400 → the parsed body
 * as { ok: false, error, variant }; any other status throws so the caller can
 * surface a network/unexpected failure (mirrors moveCard's reject-on-non-2xx).
 *
 * On success the modal closes immediately and the card's SSE-driven status line
 * takes over — there is no client-side optimistic move for this transition.
 */
export async function startCard(
  id: string,
  extraDirection: string,
): Promise<StartResult> {
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extraDirection }),
  });
  if (res.ok) {
    return { ok: true };
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      variant?: string;
    };
    return {
      ok: false,
      error: body.error ?? "Start failed.",
      variant: body.variant,
    };
  }
  throw new Error(`startCard failed: ${res.status} ${res.statusText}`);
}

/**
 * Ensure a ttyd terminal for a card's live session: POST /api/cards/:id/terminal.
 * Fire-and-forget — the backend spawns-or-reuses ttyd single-flight (202 Accepted)
 * and the SSE snapshot carries the outcome (`ttydPort` on success, `terminalError`
 * on failure), so there is no response body to parse. Resolves on 2xx; throws on any
 * non-2xx so the caller can log (mirrors moveCard's reject-on-non-2xx). Called on
 * panel-open for session cards (once per open) and again on Reconnect.
 */
export async function ensureTerminal(id: string): Promise<void> {
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`ensureTerminal failed: ${res.status} ${res.statusText}`);
  }
}

/** Discriminated result of a resume request; carries the reject status. */
export type ResumeResult = { ok: true } | { ok: false; status: number | null };

/**
 * Resume a dead In Review session: POST /api/cards/:id/resume.
 * The backend relaunches `claude --continue` in the preserved worktree (202 Accepted) and the SSE
 * snapshot carries the outcome (`tmuxSession`/`ttydPort` on success, or the card staying
 * `sessionLost` on failure), so there is no response body to parse. Returns `{ ok: true }` on 2xx;
 * `{ ok: false, status }` with the response status on a non-2xx reject (so the caller can
 * distinguish a 409 conflict from other failures); `status` is null on a network/throw failure.
 * The client sends ONLY the card id — the worktree path is server-owned, never from the body.
 */
export async function resumeCard(id: string): Promise<ResumeResult> {
  try {
    const res = await fetch(`/api/cards/${encodeURIComponent(id)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

/**
 * Offer a Done card's workspace cleanup: POST /api/cards/:id/cleanup.
 * Fire-and-forget — the backend runs the teardown saga (kill session + ttyd, remove worktrees +
 * folder, keep branches) and the SSE snapshot carries the outcome (session fields cleared on
 * success, or a muted `cleanupWarning` on partial failure), so there is no response body to parse.
 * Resolves on 2xx (202); throws on any non-2xx so the caller can log (mirrors ensureTerminal).
 * The client sends ONLY the card id — every path/session is server-derived.
 */
export async function cleanupCard(id: string): Promise<void> {
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`cleanupCard failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Open a card's workspace folder in VS Code / Cursor: POST /api/cards/:id/open-editor.
 * Sends ONLY the `editor` discriminant — the backend reads the filesystem path from the
 * server-owned `card.workspacePath`, never from the client. Fire-and-forget (204 No Content,
 * no body to parse); throws on any non-2xx so the caller can `.catch(console.error)` (mirrors
 * ensureTerminal's reject-on-non-2xx). Called from the panel's editor buttons.
 */
export async function openEditor(
  id: string,
  editor: "code" | "cursor",
): Promise<void> {
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/open-editor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editor }),
  });
  if (!res.ok) {
    throw new Error(`openEditor failed: ${res.status} ${res.statusText}`);
  }
}
