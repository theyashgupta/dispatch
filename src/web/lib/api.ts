import type {
  ActivityEvent,
  Card,
  Column,
  DirListing,
  DiscoveredRepo,
  FilterCapabilities,
  FilterOption,
  Playbook,
  PlaybookPickerResponse,
  PrerequisiteStatus,
  SourceFilters,
  UpdateRunResult,
  UpdateStatus,
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
 * `playbook` (a name, never a path) is passed through exactly as supplied — this
 * function applies no default. The bare Restart caller omits it, and
 * `JSON.stringify` drops the resulting `undefined` key so absence reaches the
 * server as the reuse-persisted-intent signal.
 */
export async function startCard(
  id: string,
  extraDirection: string,
  folder?: string,
  repos?: { path: string; base: string }[],
  playbook?: string,
): Promise<StartResult> {
  const body =
    folder !== undefined || repos !== undefined
      ? { extraDirection, folder, repos, playbook }
      : { extraDirection, playbook };
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

/** Discriminated result of a POST /cards/group request. */
export type StartGroupResult =
  | { ok: true; card: Card }
  | {
      ok: false;
      error: string;
      variant?: "config" | "playbook" | "ineligible";
      ineligibleIds?: string[];
    };

/**
 * Atomic create+start for a multi-ticket group: POST /api/cards/group. Mirrors startCard's
 * 200/400 discrimination, with the group route's 202 (create-and-start in one shot) carrying the
 * freshly-minted `card`, and a 409 surfacing the server's re-validated `ineligibleIds` so the modal
 * can report exactly which frozen-selection member fell out of eligibility between select and
 * submit — the server, not this client, is the source of truth for that check.
 */
export async function startGroup(input: {
  title: string;
  memberIds: string[];
  folder: string;
  repos: { path: string; base: string }[];
  playbook?: string;
  extraDirection?: string;
}): Promise<StartGroupResult> {
  const res = await fetch("/api/cards/group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 202) {
    const body = (await res.json()) as { card: Card };
    return { ok: true, card: body.card };
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      variant?: string;
    };
    return {
      ok: false,
      error: body.error ?? "Start failed.",
      variant:
        body.variant === "config" || body.variant === "playbook"
          ? body.variant
          : undefined,
    };
  }
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      ineligibleIds?: string[];
    };
    return {
      ok: false,
      error: body.error ?? "Some selected tickets are no longer eligible.",
      variant: "ineligible",
      ineligibleIds: body.ineligibleIds ?? [],
    };
  }
  throw new Error(`startGroup failed: ${res.status} ${res.statusText}`);
}

/**
 * Promote a `source:"local"` card to a real Linear issue: POST /api/cards/:id/sync-linear. Mirrors
 * createLocalTicket's discrimination exactly: 200 → `{ ok: true, card }` (the swapped Card, already
 * reflecting the new identifier); 409 → `{ ok: false, error }` (the parsed body's renderable copy —
 * non-local card or a sync already in flight); 404/502/network → `{ ok: false, error: null }`
 * (generic, no server-side detail to surface). The response is held open for the duration of the
 * sync (up to ~150s) — the server owns that bound, there is no client-side timeout/abort. The
 * authoritative identity swap always arrives over SSE regardless of this response, since the panel
 * stays open on the same `Card.id` throughout.
 */
export async function syncCardToLinear(
  id: string,
): Promise<{ ok: true; card: Card } | { ok: false; error: string | null }> {
  try {
    const res = await fetch(
      `/api/cards/${encodeURIComponent(id)}/sync-linear`,
      {
        method: "POST",
      },
    );
    if (res.status === 409) {
      const body = (await res.json().catch((err) => {
        console.error("syncCardToLinear: failed to parse 409 body", err);
        return {};
      })) as { error?: string };
      return { ok: false, error: body.error ?? null };
    }
    if (!res.ok) {
      return { ok: false, error: null };
    }
    const card = (await res.json()) as Card;
    return { ok: true, card };
  } catch {
    return { ok: false, error: null };
  }
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
 * List playbooks: GET /api/playbooks. Read fresh on every call so the picker/list reflects the
 * on-disk markdown without a cache — a single flat list, no stage scoping. Resolves the parsed
 * `playbooks` array on 2xx; throws on any non-2xx so the caller can surface a load failure
 * (mirrors getWorkspaceFolders).
 */
export async function getPlaybooks(): Promise<Playbook[]> {
  const res = await fetch("/api/playbooks");
  if (!res.ok) {
    throw new Error(`getPlaybooks failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { playbooks: Playbook[] };
  return body.playbooks;
}

/**
 * The StartModal picker's data source: GET /api/playbooks/picker. Read fresh on every modal open
 * so malformed rows and the remembered default always reflect the current on-disk state.
 * Resolves the parsed `{valid, invalid, lastUsed}` shape on 2xx; throws on any non-2xx (mirrors
 * getPlaybooks).
 */
export async function getPickerPlaybooks(): Promise<PlaybookPickerResponse> {
  const res = await fetch("/api/playbooks/picker");
  if (!res.ok) {
    throw new Error(
      `getPickerPlaybooks failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as PlaybookPickerResponse;
}

/** Discriminated result of a playbook create/update; carries the server's write-time rejection. */
export type PlaybookWriteResult =
  | { ok: true; playbook: Playbook }
  | { ok: false; error: "name-exists" | "footgun" | "generic" };

/** Shared shape submitted by both create and update — the server re-validates every field. */
export interface PlaybookWriteInput {
  name: string;
  body: string;
}

/**
 * Create a playbook: POST /api/playbooks. Distinguishes the two write-time rejections the editor
 * renders inline (`name-exists` from a 409, `footgun` from a 400 `{error:"footgun"}` body) from
 * every other failure, which collapses to `generic` so the editor shows one honest fallback
 * Notice. Resolves `{ok:true, playbook}` on 200.
 */
export async function createPlaybook(
  input: PlaybookWriteInput,
): Promise<PlaybookWriteResult> {
  const res = await fetch("/api/playbooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.ok) {
    const body = (await res.json()) as { playbook: Playbook };
    return { ok: true, playbook: body.playbook };
  }
  if (res.status === 409) {
    return { ok: false, error: "name-exists" };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: body.error === "footgun" ? "footgun" : "generic" };
}

/**
 * Rename/edit a playbook: PUT /api/playbooks/:slug. Same discrimination as createPlaybook
 * (`name-exists`/`footgun`/`generic`); a 404 (playbook deleted out from under the open editor)
 * also collapses to `generic` since the editor has one shared failure Notice for anything beyond
 * the two named-rejection cases.
 */
export async function updatePlaybook(
  slug: string,
  input: PlaybookWriteInput,
): Promise<PlaybookWriteResult> {
  const res = await fetch(`/api/playbooks/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.ok) {
    const body = (await res.json()) as { playbook: Playbook };
    return { ok: true, playbook: body.playbook };
  }
  if (res.status === 409) {
    return { ok: false, error: "name-exists" };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: body.error === "footgun" ? "footgun" : "generic" };
}

/**
 * Delete a playbook: DELETE /api/playbooks/:slug. The confirm modal only needs a bare success/fail
 * signal (a 404 reads the same as any other failure — "couldn't delete, try again"), so this
 * resolves a plain `{ok}` rather than a full discriminated union.
 */
export async function deletePlaybook(slug: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/playbooks/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
  return { ok: res.ok };
}

/**
 * Generate a playbook draft via headless `claude -p`: POST /api/playbooks/generate. The server owns
 * the ~150s generation bound and always responds within it — no client-side abort timer. The panel
 * has exactly one failure surface (bad input, source-read failure, or the generation itself
 * failing/timing out all read the same to the user), so this resolves a plain `{ok, draft?}` rather
 * than fanning out server error codes.
 */
export async function generatePlaybookDraft(input: {
  direction: string;
  sourcePaths: string[];
}): Promise<{ ok: true; draft: string } | { ok: false }> {
  try {
    const res = await fetch("/api/playbooks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      return { ok: false };
    }
    const body = (await res.json()) as { draft: string };
    return { ok: true, draft: body.draft };
  } catch {
    return { ok: false };
  }
}

/**
 * Generate a local ticket draft via headless `claude -p`: POST /api/cards/draft. Deliberately does
 * NOT catch/swallow errors the way `generatePlaybookDraft` does — the caller passes an
 * `AbortSignal` and needs to distinguish a user-initiated abort (the fetch promise rejects with
 * `AbortError`) from every other failure. Non-OK statuses (the route's 400/409/502 cases) resolve
 * `{ ok: false }`; a genuine abort or network failure REJECTS, left for the caller's catch block.
 */
export async function generateTicketDraft(
  direction: string,
  signal: AbortSignal,
): Promise<{ ok: true; title: string; description: string } | { ok: false }> {
  const res = await fetch("/api/cards/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction }),
    signal,
  });
  if (!res.ok) {
    return { ok: false };
  }
  const body = (await res.json()) as { title: string; description: string };
  return { ok: true, title: body.title, description: body.description };
}

/**
 * Persist a reviewed/edited ticket draft: POST /api/cards. The server mints the `LOCAL-<n>`
 * identifier and re-validates title/description (incl. the DISPATCH_STATUS footgun guard) — the
 * client's draft is never trusted. Resolves the created `Card` on 201. Mirrors
 * `addWorkspaceFolder`'s 400 discrimination: a validation rejection returns the parsed `{ error }`
 * code so the modal can render actionable copy (the server WAS reached and retrying can't help),
 * while network failures and every other status resolve `{ ok: false, error: null }` for the
 * generic unreachable-server line.
 */
export async function createLocalTicket(
  title: string,
  description: string,
): Promise<{ ok: true; card: Card } | { ok: false; error: string | null }> {
  try {
    const res = await fetch("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? null };
    }
    if (!res.ok) {
      return { ok: false, error: null };
    }
    const card = (await res.json()) as Card;
    return { ok: true, card };
  } catch {
    return { ok: false, error: null };
  }
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
 * List the child directories of a folder for the folder-browser picker:
 * GET /api/fs/dirs?path=. `path` is OPTIONAL (server defaults to `~`), unlike
 * `discoverFolder`'s required param, so the query string is built conditionally.
 * Resolves the parsed `DirListing` on 2xx; throws on non-2xx (mirrors discoverFolder).
 */
export async function browseDirectory(path?: string): Promise<DirListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/fs/dirs${query}`);
  if (!res.ok) {
    throw new Error(`browseDirectory failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as DirListing;
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
  node: { version: string; floor: string; ok: boolean };
  storage: { ok: boolean; path: string };
}> {
  const res = await fetch("/api/setup");
  if (!res.ok) {
    throw new Error(`getSetup failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as {
    needsKey: boolean;
    prerequisites: PrerequisiteStatus[];
    node: { version: string; floor: string; ok: boolean };
    storage: { ok: boolean; path: string };
  };
}

/**
 * Run the guided install for one prerequisite on first run: POST /api/setup/install { target }.
 * Drives the shared preflight `runInstall` over the loopback route (whitelist-validated to
 * tmux/ttyd/git server-side) and resolves the re-probed status so the setup screen can flip the row.
 * The Linear key never crosses this boundary and there is no streaming — a single request/response.
 * Resolves `{ ok, command, status }` on 2xx; throws on any non-2xx so the component renders the
 * failure state (mirrors moveCard's reject-on-non-2xx).
 */
export async function runPrerequisiteInstall(target: string): Promise<{
  ok: boolean;
  command: string;
  status: PrerequisiteStatus;
}> {
  const res = await fetch("/api/setup/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) {
    throw new Error(
      `runPrerequisiteInstall failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as {
    ok: boolean;
    command: string;
    status: PrerequisiteStatus;
  };
}

/**
 * Submit the Linear key on first run: POST /api/setup. The server tests the key against Linear
 * before persisting, so the discriminated result maps each failure mode distinctly: 200 → { ok:true }
 * (board hydrates over the live SSE, no reload); 502 → { ok:false, reason:"unreachable" } (couldn't
 * reach Linear); 409 → { ok:false, reason:"already-configured" } (a key already exists — a benign
 * two-tab race, NOT a bad key, so the caller can transition straight to the board); any other non-2xx
 * (400) → { ok:false, reason:"rejected" }. The key is sent once and never echoed back.
 */
export async function saveLinearKey(
  apiKey: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: "rejected" | "unreachable" | "already-configured" }
> {
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
  if (res.status === 409) {
    return { ok: false, reason: "already-configured" };
  }
  return { ok: false, reason: "rejected" };
}

/**
 * Enable remote access: POST /api/remote/enable. Fire-and-forget from the caller's perspective —
 * the authoritative status (starting/on/error/binary-missing) arrives over the `tunnel` SSE frame,
 * not this response. Rejects on non-2xx so the caller can log (mirrors moveCard).
 */
export async function enableRemote(): Promise<void> {
  const res = await fetch("/api/remote/enable", { method: "POST" });
  if (!res.ok) {
    throw new Error(`enableRemote failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Disable remote access: POST /api/remote/disable. The `tunnel` SSE frame carries the resulting
 * `off` state. Rejects on non-2xx so the caller can log (mirrors moveCard).
 */
export async function disableRemote(): Promise<void> {
  const res = await fetch("/api/remote/disable", { method: "POST" });
  if (!res.ok) {
    throw new Error(`disableRemote failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Read the cached update status: GET /api/update. Fired once on the update banner's mount; the
 * server serves the 24h-cached registry check, never a fresh network hit per page load. Throws on
 * any non-2xx so the banner stays hidden on failure (fail-silent, per the locked design).
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  const res = await fetch("/api/update");
  if (!res.ok) {
    throw new Error(`getUpdateStatus failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as UpdateStatus;
}

/**
 * Run the loopback update: POST /api/update/run. Sends no body — install mode and the target
 * package are entirely server-resolved. Throws only on a genuine non-2xx (network/500) failure;
 * the 200 body's `ok:true/false` discriminant is a valid application state the banner renders, not
 * a thrown error.
 */
export async function runUpdate(): Promise<UpdateRunResult> {
  const res = await fetch("/api/update/run", { method: "POST" });
  if (!res.ok) {
    throw new Error(`runUpdate failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as UpdateRunResult;
}
