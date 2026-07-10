import type { Column, DiscoveredRepo, Playbook } from "../../shared/types.js";

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
 *
 * A fresh start passes the chosen `folder` + `repos` (checked repos with their
 * per-ticket base). Restart/retry callers omit both so the body stays exactly
 * `{ extraDirection }` and the backend reuses the persisted `card.workspace`.
 *
 * `playbook` (a name, never a path) and `targetColumn` are passed through exactly
 * as supplied — this function applies no default. A modal-driven start always
 * supplies an explicit `targetColumn` so the server honors it (Case 1); the bare
 * Restart caller supplies neither, and `JSON.stringify` drops the resulting
 * `undefined` keys so that absence reaches the server as the preserve-column signal.
 */
export async function startCard(
  id: string,
  extraDirection: string,
  folder?: string,
  repos?: { path: string; base: string }[],
  playbook?: string,
  targetColumn?: "in_planning" | "in_progress",
): Promise<StartResult> {
  const body =
    folder !== undefined || repos !== undefined
      ? { extraDirection, folder, repos, playbook, targetColumn }
      : { extraDirection, playbook, targetColumn };
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
 * List the playbooks for a methodology stage: GET /api/playbooks?stage=.
 * Read fresh on every start-modal open so the picker reflects the on-disk
 * markdown without a cache. Resolves the parsed `playbooks` array on 2xx; throws
 * on any non-2xx so the modal can surface a load failure (mirrors getWorkspaceFolders).
 */
export async function getPlaybooks(
  stage: "planning" | "implementation",
): Promise<Playbook[]> {
  const res = await fetch(`/api/playbooks?stage=${encodeURIComponent(stage)}`);
  if (!res.ok) {
    throw new Error(`getPlaybooks failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { playbooks: Playbook[] };
  return body.playbooks;
}

/**
 * Send a follow-up kickoff into a card's live session: POST /api/cards/:id/kickoff.
 * The In Planning → In Progress live hand-off: the server splices the chosen
 * implementation `playbook` (a name, never a path; omitted for the Default option)
 * plus the `extra` direction and sends it into the same tmux session — no
 * re-provisioning. Mirrors startCard's discrimination so a dead-session reject
 * (400/409 with `{ error, variant }`) falls through to session-lost treatment;
 * any other status throws for a network/unexpected failure.
 */
export async function sendKickoff(
  id: string,
  opts: { playbook?: string; extra: string },
): Promise<StartResult> {
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/kickoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playbook: opts.playbook, extra: opts.extra }),
  });
  if (res.ok) {
    return { ok: true };
  }
  if (res.status === 400 || res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      variant?: string;
    };
    return {
      ok: false,
      error: body.error ?? "Hand-off failed.",
      variant: body.variant,
    };
  }
  throw new Error(`sendKickoff failed: ${res.status} ${res.statusText}`);
}

/**
 * List the registered workspace folders: GET /api/workspace-folders.
 * Read on modal open so the folder dropdown has the authoritative registry plus
 * the last-used folder to preselect. Resolves the parsed body on 2xx; throws on
 * any non-2xx so the caller can surface a load failure.
 */
export async function getWorkspaceFolders(): Promise<{
  folders: string[];
  lastUsed: string | null;
}> {
  const res = await fetch("/api/workspace-folders");
  if (!res.ok) {
    throw new Error(
      `getWorkspaceFolders failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as { folders: string[]; lastUsed: string | null };
}

/**
 * Register + discover a workspace folder: POST /api/workspace-folders { path }.
 * The server owns all path normalization/validation/discovery — the client only
 * forwards the typed path and renders the result. Mirrors startCard's 200/400
 * discrimination so the modal can show the inline validation error verbatim:
 * 200 → { ok:true, repos }; 400 → { ok:false, error } (parsed body); else throws.
 */
export async function addWorkspaceFolder(
  path: string,
): Promise<
  { ok: true; repos: DiscoveredRepo[] } | { ok: false; error: string }
> {
  const res = await fetch("/api/workspace-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (res.ok) {
    const body = (await res.json()) as { repos: DiscoveredRepo[] };
    return { ok: true, repos: body.repos };
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "Couldn't add folder." };
  }
  throw new Error(`addWorkspaceFolder failed: ${res.status} ${res.statusText}`);
}

/**
 * Re-discover an already-registered folder: GET /api/workspace-folders/discover?path=.
 * Fired on folder switch/selection to refresh the repo checklist; a registered
 * folder whose directory was deleted returns { repos: [] } (200), which renders
 * the empty-checklist notice. Resolves the parsed body on 2xx; throws on non-2xx.
 */
export async function discoverFolder(
  path: string,
): Promise<{ repos: DiscoveredRepo[] }> {
  const res = await fetch(
    `/api/workspace-folders/discover?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    throw new Error(`discoverFolder failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { repos: DiscoveredRepo[] };
}

/**
 * Drop a folder from the registry: DELETE /api/workspace-folders { path }.
 * The client half of the frictionless remove-✕ (no confirmation, no filesystem
 * touch); the endpoint is idempotent so a double-remove is harmless. Resolves on
 * 2xx; throws on any non-2xx so the caller can log (the SSE snapshot reconciles).
 */
export async function removeWorkspaceFolder(path: string): Promise<void> {
  const res = await fetch("/api/workspace-folders", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    throw new Error(
      `removeWorkspaceFolder failed: ${res.status} ${res.statusText}`,
    );
  }
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
