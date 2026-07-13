import type {
  ActivityEvent,
  Column,
  DiscoveredRepo,
  FilterCapabilities,
  FilterOption,
  Playbook,
  PrerequisiteStatus,
  SourceFilters,
} from "../../shared/types.js";

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
 * Read the newest-first event log: GET /api/events (+ optional `?cardId=` scope and `?limit=`).
 * Hydrates the activity buffer once on mount and backfills a card's timeline on open. Resolves the
 * parsed `events` array on 2xx; throws on any non-2xx so the caller can decide (the feed keeps its
 * last-known buffer on failure — no spinner). Mirrors getPlaybooks' reject-on-non-2xx.
 */
export async function fetchEvents(
  cardId?: string,
  limit?: number,
): Promise<ActivityEvent[]> {
  const params = new URLSearchParams();
  if (cardId !== undefined) params.set("cardId", cardId);
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  const res = await fetch(`/api/events${query ? `?${query}` : ""}`);
  if (!res.ok) {
    throw new Error(`fetchEvents failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { events: ActivityEvent[] };
  return body.events;
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
 * The client sends ONLY the card id and a `force` flag — every path/session is server-derived.
 * `force: true` bypasses the dirty-worktree preflight and discards uncommitted work (PRE-02).
 */
export async function cleanupCard(id: string, force = false): Promise<void> {
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
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

/**
 * Read the Linear source's persisted filters plus its capability descriptor:
 * GET /api/sources/linear/filters. Fired once on settings-modal open (never on
 * the poll loop) to seed the draft and decide which dimensions to render (SRC-06).
 * The apiKey never crosses this boundary — the route returns only { filters,
 * capabilities }. Resolves the parsed body on 2xx; throws on any non-2xx so the
 * modal can surface a load failure (mirrors getPlaybooks/getWorkspaceFolders).
 */
export async function getLinearFilters(): Promise<{
  filters: SourceFilters;
  capabilities: FilterCapabilities;
}> {
  const res = await fetch("/api/sources/linear/filters");
  if (!res.ok) {
    throw new Error(`getLinearFilters failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as {
    filters: SourceFilters;
    capabilities: FilterCapabilities;
  };
}

/**
 * List the live workspace options for one multi-select dimension:
 * GET /api/sources/linear/options?dimension=. Fired per dropdown on modal open so
 * the picker reflects the current workspace. Resolves the parsed `options` array on
 * 2xx plus a `truncated` flag (true when the source capped the list at its first
 * page) so the modal can disclose the cap; throws on any non-2xx (incl. the 502
 * upstream-failure) so the modal renders its per-dimension "Couldn't load options"
 * line for that field.
 */
export async function getLinearOptions(
  dimension: "assignees" | "projects" | "teams",
): Promise<{ options: FilterOption[]; truncated: boolean }> {
  const res = await fetch(
    `/api/sources/linear/options?dimension=${encodeURIComponent(dimension)}`,
  );
  if (!res.ok) {
    throw new Error(`getLinearOptions failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    options: FilterOption[];
    truncated?: boolean;
  };
  return { options: body.options, truncated: body.truncated === true };
}

/**
 * Count the tickets a draft filter would match: POST /api/sources/linear/preview.
 * Advisory only — it drives the debounced match-count line and must NEVER block
 * Save, so ANY failure (a non-2xx incl. the 502 upstream error, or a network
 * throw) resolves to `null` (the "preview unavailable" sentinel) instead of
 * rejecting. Resolves `{ count, more }` on 2xx.
 */
export async function previewLinearFilters(
  filters: SourceFilters,
): Promise<{ count: number; more: boolean } | null> {
  try {
    const res = await fetch("/api/sources/linear/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters }),
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as { count: number; more: boolean };
  } catch {
    return null;
  }
}

/**
 * Persist the Linear source's filter draft: PUT /api/sources/linear/filters.
 * The server validates the shape (rejecting unknown dimensions) and re-polls
 * race-free. Mirrors addWorkspaceFolder's 200/400 discrimination so the modal
 * shows the inline validation error verbatim: 200 → { ok:true }; 400 →
 * { ok:false, error } (parsed body); any other status throws so the caller can
 * surface a network/unexpected failure.
 */
export async function saveLinearFilters(
  filters: SourceFilters,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/sources/linear/filters", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters }),
  });
  if (res.ok) {
    return { ok: true };
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "Couldn't save filters." };
  }
  throw new Error(`saveLinearFilters failed: ${res.status} ${res.statusText}`);
}

/**
 * Read first-run status: GET /api/setup. Fired once on app mount to gate the setup screen vs the
 * board. Returns `needsKey` plus the live prerequisite checklist; the Linear key never crosses this
 * boundary. Throws on any non-2xx so the caller can fail-open to the board rather than trapping a
 * fresh install behind a fetch error.
 */
export async function getSetup(): Promise<{
  needsKey: boolean;
  prerequisites: PrerequisiteStatus[];
}> {
  const res = await fetch("/api/setup");
  if (!res.ok) {
    throw new Error(`getSetup failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as {
    needsKey: boolean;
    prerequisites: PrerequisiteStatus[];
  };
}

/**
 * Submit the Linear key on first run: POST /api/setup. The server tests the key against Linear
 * before persisting, so the discriminated result maps the two failure modes to the setup screen's
 * two error strings: 200 → { ok:true } (board hydrates over the live SSE, no reload); 502 →
 * { ok:false, reason:"unreachable" } (couldn't reach Linear); any other non-2xx (400 rejected, 409
 * already-configured) → { ok:false, reason:"rejected" }. The key is sent once and never echoed back.
 */
export async function saveLinearKey(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; reason: "rejected" | "unreachable" }> {
  const res = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (res.ok) {
    return { ok: true };
  }
  if (res.status === 502) {
    return { ok: false, reason: "unreachable" };
  }
  return { ok: false, reason: "rejected" };
}
