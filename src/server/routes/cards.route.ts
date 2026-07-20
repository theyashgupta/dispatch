import { Router, type Request, type Response } from "express";
import { COLUMNS, type Card, type Column } from "../../shared/types.js";
import { isDemoteEligible } from "../../shared/demote-eligibility.js";
import { store } from "../store/board.store.js";
import { startSession } from "../services/orchestration/start-session.js";
import { resumeSession } from "../services/orchestration/resume-session.js";
import { cleanupWorkspace } from "../services/orchestration/cleanup.js";
import { ensureTerminal } from "../services/orchestration/terminal.js";
import { editorPath, launchEditor } from "../adapters/editors.js";
import { getOrchestrationConfig } from "../services/infra/config-holder.js";
import { restatRepos } from "../services/domain/workspaces.js";
import {
  loadPlaybooks,
  hasDispatchMarker,
} from "../services/domain/playbooks.js";
import { generateTicketDraft } from "../services/orchestration/ticket-generate.js";
import { syncCardToLinear } from "../services/orchestration/linear-sync.js";

export const cardsRouter = Router();

const MAX_DIRECTION_LEN = 10000;
const MAX_TITLE_LEN = 300;
const MAX_DESCRIPTION_LEN = 20000;

/**
 * `/move`'s own whitelist, distinct from `COLUMNS` (the board's render list). Inbox is a valid
 * move target (promote/demote) but must stay OUT of `COLUMNS` so it can never become a board
 * column or a drag-drop target — this is the first feature to split those two concerns.
 */
const MOVABLE_COLUMNS: readonly Column[] = [...COLUMNS, "inbox"];

/**
 * Server-side enforcement of the sanctioned inbox transitions, mirroring the client gates so one
 * curl can't bypass what the UI enforces (the same posture `/start` takes with its promote-first
 * 409): from the Inbox the ONLY legal move is promotion to To Do — anything else would skip the
 * promote-first rule and the `promotedAt` stamp, and could park a marker-reachable card in a view
 * with zero session affordances; INTO the Inbox only a To Do card that passes the shared
 * `isDemoteEligible` predicate (no session history, no start saga) may travel, and an in-flight
 * start additionally 409s via `store.isStarting` — the same guard `/resume` and `/cleanup` apply.
 * Board-to-board moves are deliberately untouched. Returns the 409 copy, or null when legal.
 */
function inboxTransitionError(card: Card, column: Column): string | null {
  if (card.column === "inbox" && column !== "todo")
    return "inbox cards can only be promoted to To Do";
  if (column !== "inbox") return null;
  if (card.column !== "todo") return "only To Do cards can be moved to Inbox";
  if (store.isStarting(card.id)) return "a start is in flight for this card";
  if (!isDemoteEligible(card))
    return "cards with session history cannot be moved to Inbox";
  return null;
}

cardsRouter.post("/cards/:id/move", async (req, res) => {
  const { id } = req.params;
  const column = (req.body as { column?: unknown } | undefined)?.column;

  if (
    typeof column !== "string" ||
    !MOVABLE_COLUMNS.includes(column as Column)
  ) {
    res.status(400).json({
      error: `invalid column; must be one of: ${MOVABLE_COLUMNS.join(", ")}`,
    });
    return;
  }
  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  const transitionError = inboxTransitionError(card, column as Column);
  if (transitionError != null) {
    res.status(409).json({ error: transitionError });
    return;
  }

  await store.moveCardManual(id, column as Column);
  res.status(200).json(store.snapshot());
});

cardsRouter.post("/cards/:id/start", async (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (card.column === "done") {
    res.status(409).json({ error: "cannot start a session for a Done card" });
    return;
  }

  if (card.column === "inbox") {
    res.status(409).json({
      error: "cannot start a session from the Inbox — promote to To Do first",
    });
    return;
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    res
      .status(400)
      .json({ error: `invalid ticket identifier: ${card.identifier}` });
    return;
  }

  const config = getOrchestrationConfig();
  if (!config) {
    res
      .status(400)
      .json({ error: "orchestration config is not loaded", variant: "config" });
    return;
  }

  const body = req.body as
    | {
        extraDirection?: unknown;
        folder?: unknown;
        repos?: unknown;
        playbook?: unknown;
      }
    | undefined;
  const extraDirection =
    typeof body?.extraDirection === "string" ? body.extraDirection : "";
  const playbook =
    typeof body?.playbook === "string" ? body.playbook : undefined;

  if (playbook !== undefined) {
    const known = (await loadPlaybooks()).some((p) => p.name === playbook);
    if (!known) {
      res.status(400).json({ error: "unknown playbook", variant: "playbook" });
      return;
    }
  }

  const folder = body?.folder;
  const rawRepos = body?.repos;
  const hasWorkspacePayload =
    typeof folder === "string" &&
    Array.isArray(rawRepos) &&
    rawRepos.length > 0 &&
    rawRepos.every(
      (r) =>
        r !== null &&
        typeof r === "object" &&
        typeof (r as { path?: unknown }).path === "string" &&
        typeof (r as { base?: unknown }).base === "string",
    );

  if (hasWorkspacePayload) {
    const repos = (rawRepos as { path: string; base: string }[]).map((r) => ({
      path: r.path,
      base: r.base,
    }));
    if (repos.some((r) => r.base.startsWith("-"))) {
      res.status(400).json({
        error: "invalid base branch",
        variant: "config",
      });
      return;
    }
    if (!(await restatRepos(repos))) {
      res.status(400).json({
        error: "Can't start — a selected repo is missing",
        variant: "config",
      });
      return;
    }
    await store.setCardWorkspace(id, { folder, repos });
  } else if (!card.workspace) {
    res.status(400).json({
      error: "No workspace selected for this ticket",
      variant: "config",
    });
    return;
  }

  void startSession(id, extraDirection, config, { playbook });
  res.status(202).json({ started: true });
});

cardsRouter.post("/cards/:id/resume", (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (card.column !== "in_review") {
    res.status(409).json({
      error: "can only resume a session for an In Review card",
    });
    return;
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    res
      .status(400)
      .json({ error: `invalid ticket identifier: ${card.identifier}` });
    return;
  }

  if (!card.workspacePath) {
    res.status(400).json({ error: "card has no workspace to resume" });
    return;
  }

  if (card.tmuxSession) {
    res.status(409).json({ error: "session is already live" });
    return;
  }

  if (card.sessionLost !== true) {
    res.status(409).json({ error: "card has no lost session to resume" });
    return;
  }

  if (store.isStarting(id)) {
    res.status(409).json({ error: "a start is in flight for this card" });
    return;
  }

  void resumeSession(id);
  res.status(202).json({ resuming: true });
});

cardsRouter.post("/cards/:id/terminal", (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (!card.tmuxSession) {
    res.status(400).json({ error: "card has no live session" });
    return;
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    res
      .status(400)
      .json({ error: `invalid ticket identifier: ${card.identifier}` });
    return;
  }

  void ensureTerminal(card.id, card.tmuxSession);
  res.status(202).json({ ensuring: true });
});

cardsRouter.post("/cards/:id/open-editor", (req, res) => {
  const { id } = req.params;

  const editor = (req.body as { editor?: unknown } | undefined)?.editor;
  if (editor !== "code" && editor !== "cursor") {
    res
      .status(400)
      .json({ error: `invalid editor; must be one of: code, cursor` });
    return;
  }

  if (editorPath(editor) == null) {
    res.status(400).json({ error: `editor "${editor}" is not available` });
    return;
  }

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (!card.workspacePath) {
    res.status(400).json({ error: "card has no workspace" });
    return;
  }

  void launchEditor(editor, card.workspacePath).catch((err) => {
    console.error(`[open-editor] launch failed for card ${id}:`, err);
  });
  res.status(204).end();
});

cardsRouter.post("/cards/:id/cleanup", (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }
  if (card.column !== "done") {
    res.status(409).json({ error: "cleanup is only available for Done cards" });
    return;
  }
  if (store.isStarting(id)) {
    res.status(409).json({ error: "a start is in flight for this card" });
    return;
  }

  const force = (req.body as { force?: unknown } | undefined)?.force === true;
  void cleanupWorkspace(id, { force }).catch((err) => {
    console.error(`[cleanup] failed for card ${id}:`, (err as Error).message);
  });
  res.status(202).json({ cleaning: true });
});

/**
 * Module-level single-flight guard for `POST /cards/draft`, deliberately its OWN state — NEVER
 * shared with `playbooks.route.ts`'s `generateInFlight` (mirrors that file's precedent exactly,
 * but the two draft-generation surfaces are unrelated features a user could legitimately have
 * open at once). Rejects a concurrent call with 409 rather than fanning out parallel `claude -p`
 * subprocesses (a denial-of-service concern for this endpoint, per the phase's threat register).
 *
 * @remarks Live-smoke-discovered fix (61-03): the handler's abort-on-disconnect wiring listens on
 * `res`, not `req`. `req.on("close")` fires as soon as the request's readable stream is fully
 * consumed (i.e. once `express.json()` finishes reading the body) — well before any response is
 * sent — regardless of whether the client is still connected and waiting. That made every real
 * invocation abort itself within milliseconds of entering the handler, silently dropping the
 * response (the `.catch` branch returns early on an aborted signal without ever calling
 * `res.status(...)`), so the client hung until its own timeout. `res.on("close")` only fires when
 * the underlying connection ends WITHOUT the response having been fully written, which is what
 * "the client disconnected before generation finished" actually means; the existing
 * `!res.writableEnded` guard still excludes the normal-completion case.
 */
let draftInFlight = false;

cardsRouter.post("/cards/draft", (req, res) => {
  const rawDirection = (req.body as { direction?: unknown } | undefined)
    ?.direction;
  const direction = typeof rawDirection === "string" ? rawDirection.trim() : "";
  if (direction === "" || direction.length > MAX_DIRECTION_LEN) {
    res.status(400).json({ error: "invalid-direction" });
    return;
  }

  if (draftInFlight) {
    res.status(409).json({ error: "generate-in-progress" });
    return;
  }

  draftInFlight = true;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  generateTicketDraft(direction, controller.signal)
    .then((draft) => {
      if (controller.signal.aborted) return;
      res.status(200).json(draft);
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      console.warn("[cards/draft] generation failed:", (err as Error).message);
      res.status(502).json({ error: "generate-failed" });
    })
    .finally(() => {
      draftInFlight = false;
    });
});

cardsRouter.post("/cards", async (req, res) => {
  const body = req.body as
    { title?: unknown; description?: unknown } | undefined;

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (title === "" || title.length > MAX_TITLE_LEN) {
    res.status(400).json({ error: "invalid-title" });
    return;
  }

  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  if (description === "" || description.length > MAX_DESCRIPTION_LEN) {
    res.status(400).json({ error: "invalid-description" });
    return;
  }

  if (hasDispatchMarker(title) || hasDispatchMarker(description)) {
    res
      .status(400)
      .json({ error: "content contains the DISPATCH_STATUS marker" });
    return;
  }

  const card = await store.createLocalCard(title, description);
  res.status(201).json(card);
});

/**
 * Adoption-time footgun screen (RESEARCH pitfall 4): the adopted title/description come back from
 * Linear's canonical copy, which could theoretically carry the reserved marker (e.g. a
 * pre-existing issue found via the idempotency search). A field carrying it falls back to the
 * card's CURRENT local value instead of failing the sync — the issue already exists, so identity
 * must still adopt.
 */
function screenAdoptedFields(
  result: {
    identifier: string;
    url: string;
    issueId: string;
    title: string;
    description: string;
  },
  card: Card,
): {
  identifier: string;
  url: string;
  issueId: string;
  title: string;
  description: string;
} {
  return {
    identifier: result.identifier,
    url: result.url,
    issueId: result.issueId,
    title: hasDispatchMarker(result.title) ? card.title : result.title,
    description: hasDispatchMarker(result.description)
      ? (card.description ?? "")
      : result.description,
  };
}

/**
 * Promote a `source:"local"` card to a real Linear issue (PUSH-01/02/03). Mounted on `cardsRouter`
 * -> already behind `apiRouter`'s `isLocalRequest` loopback gate (`routes/index.ts`) — no new gate
 * code needed here. Uses a 404 for an unknown card id, a DELIBERATE deviation from this file's other
 * routes' 400-for-unknown-card (documented per the RESEARCH contract). The per-card single-flight
 * guard follows the `isStarting` discipline EXACTLY: `store.isSyncing` is checked and
 * `store.beginSync` is called SYNCHRONOUSLY with no `await` between them, so a concurrent request
 * for the SAME card can never race past the guard; a DIFFERENT card's sync is unaffected (the guard
 * is keyed by card id, never a global flag). The subprocess call carries NO abort-on-disconnect
 * wiring — the service's own no-signal decision — so the server owns the full timeout bound and a
 * client disconnect can never orphan a created-but-unadopted Linear issue mid-flight. The 200 body
 * is drawn from `snapshot()` — the store's single outbound redaction chokepoint — never the live
 * Map entry, so a started local card's `hookToken` can never ride the response (SECURITY).
 */
async function syncLinearHandler(
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(404).json({ error: `unknown card id: ${id}` });
    return;
  }

  if ((card.source ?? "linear") !== "local") {
    res
      .status(409)
      .json({ error: "only local tickets can be synced to Linear" });
    return;
  }

  if (store.isSyncing(id)) {
    res
      .status(409)
      .json({ error: "a sync is already in flight for this card" });
    return;
  }

  store.beginSync(id);
  void store.setSyncing(id, true);

  try {
    const result = await syncCardToLinear({
      id: card.id,
      title: card.title,
      description: card.description,
    });

    const adopted = screenAdoptedFields(result, card);
    await store.adoptLinearIdentity(id, adopted);
    res.status(200).json(store.snapshot().cards.find((c) => c.id === id));
  } catch (err) {
    console.warn(
      `[sync-linear] failed for card ${id}:`,
      (err as Error).message,
    );
    await store.recordSyncError(
      id,
      "Sync to Linear failed — retrying is safe, no duplicate will be created.",
    );
    res.status(502).json({ error: "sync-failed" });
  } finally {
    store.endSync(id);
  }
}

cardsRouter.post("/cards/:id/sync-linear", syncLinearHandler);
