import { Router, type Request, type Response } from "express";
import { COLUMNS, type Card, type Column } from "../../shared/types.js";
import { isDemoteEligible } from "../../shared/demote-eligibility.js";
import { redactCard, store } from "../store/board.store.js";
import {
  blocksAgentDoneManualEntry,
  blocksTodoToInProgressManualMove,
  isManualMoveAllowed,
} from "../../shared/column-transitions.js";
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
import {
  generateGroupTitlePhrase,
  type GroupTitleMember,
} from "../services/orchestration/group-title-generate.js";
import { syncCardToLinear } from "../services/orchestration/linear-sync.js";

export const cardsRouter = Router();

const MAX_DIRECTION_LEN = 10000;
const MAX_TITLE_LEN = 300;
const MAX_DESCRIPTION_LEN = 20000;
const MAX_GROUP_TITLE_MEMBERS = 50;

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

/**
 * `BOARD-07`'s route-side mirror: reads the SAME `isManualMoveAllowed` predicate
 * `moveCardManual` consults, so the 409 message and the store's silent guard can never disagree
 * about which pairs are blocked. The named predicates only choose which message applies; they are
 * never a second, independent decision.
 * @remarks The fallthrough is a REFUSAL, not a pass. `isManualMoveAllowed` is the growth point for
 * the blocked set, and the two named predicates below only exist to phrase the two pairs blocked
 * today. A rule added to the allowlist without a matching message here must still 409 — returning
 * `null` would hand the caller a 200 while `moveCardManual` silently no-ops, reinstating at the
 * route layer exactly the invisible refusal `BOARD-07` exists to remove.
 */
function manualMoveTransitionError(card: Card, column: Column): string | null {
  if (isManualMoveAllowed(card.column, column)) return null;
  if (blocksAgentDoneManualEntry(column))
    return "Agent Done is set automatically by a real agent completion signal — it is never a manual move target";
  if (blocksTodoToInProgressManualMove(card.column, column))
    return "starting a To Do card requires the start flow — drag it to In Progress (or use Start) rather than posting a bare move";
  return `moving ${card.column} → ${column} is not an allowed manual transition`;
}

/**
 * GROUP-03 as a SERVER invariant, not a UI convention: a grouped member is never independently
 * progressable, including during the pre-start/failed-start window where it still sits in To Do
 * (session/workspace fields live only on the group card). Called at the top of every single-card
 * action handler, right after the card-exists lookup and before any other validation — the same
 * `isStarting`/inbox-guard 409 posture this file already uses. Returns `null` for an ungrouped card
 * (including the group card itself, which never carries `groupId`).
 */
function groupedMemberError(card: Card): string | null {
  if (card.groupId == null) return null;
  return `card is grouped under ${card.groupId} — act on the group card`;
}

/**
 * `GET /api/cards/:id` — a single-card fetch for a search result outside the loaded window
 * (SCALE-03). Answers an unknown id exactly the way `/move`, `/start`, `/resume`, `/terminal`,
 * `/open-editor`, and `/cleanup` already do in THIS file — a plain `res.status(400)` — a
 * DELIBERATE, VERIFIED choice that corrects RESEARCH and UI-SPEC, which each assumed the
 * REST-conventional not-found status for a GET; `sync-linear`'s use of that different status is
 * the sole documented deviation in this file and is not a precedent to extend here. Routes through
 * {@link redactCard} — the store's single sanctioned redaction site — so a single-card fetch can
 * never re-implement the `hookToken` strip via its own drift-prone copy, and can never widen what
 * `store.snapshot()` already redacts (`T-82-03`). The `members` array in the response routes
 * through that same single sanctioned redaction site as `card` — every entry passes through
 * {@link redactCard} below, never a second inline strip (`T-82-03`).
 */
function getCardById(req: Request<{ id: string }>, res: Response): void {
  const { id } = req.params;
  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }
  const members =
    card.source === "group" ? store.membersOf(card.id).map(redactCard) : [];
  res.status(200).json({ card: redactCard(card), members });
}

cardsRouter.get("/cards/:id", getCardById);

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
  const groupError = groupedMemberError(card);
  if (groupError != null) {
    res.status(409).json({ error: groupError });
    return;
  }

  const transitionError = inboxTransitionError(card, column as Column);
  if (transitionError != null) {
    res.status(409).json({ error: transitionError });
    return;
  }

  const manualMoveError = manualMoveTransitionError(card, column as Column);
  if (manualMoveError != null) {
    res.status(409).json({ error: manualMoveError });
    return;
  }

  await store.moveCardManual(id, column as Column);
  res.status(204).end();
});

/**
 * `inheritFrom`, when present, is client-supplied and ultimately selects a git ref for
 * `createWorktrees`' `baseRef` (via the parent session's own persisted `branch`). It is
 * re-validated here against membership in THIS card's `card.sessions` — never trusted as a ref
 * itself and never checked against the global session space — the same argument-injection
 * surface the `base.startsWith("-")` guard in `steps.ts` exists to stop. Requiring `newSession`
 * alongside it means a caller can never believe it inherited when the field was silently dropped.
 */
function inheritFromError(
  card: Card,
  newSession: boolean,
  inheritFrom: string | undefined,
): string | null {
  if (inheritFrom === undefined) return null;
  if (!newSession) return "inheritance requires a new session";
  if (!card.sessions?.some((s) => s.id === inheritFrom))
    return "unknown session to inherit from";
  return null;
}

cardsRouter.post("/cards/:id/start", async (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }
  const groupError = groupedMemberError(card);
  if (groupError != null) {
    res.status(409).json({ error: groupError });
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

  const body = req.body as
    | {
        extraDirection?: unknown;
        folder?: unknown;
        repos?: unknown;
        playbook?: unknown;
        newSession?: unknown;
        inheritFrom?: unknown;
      }
    | undefined;
  const newSession = body?.newSession === true;
  const inheritFrom =
    typeof body?.inheritFrom === "string" ? body.inheritFrom : undefined;

  if (
    newSession &&
    !card.sessions?.some((s) => s.id === card.activeSessionId)
  ) {
    res
      .status(409)
      .json({ error: "no existing session to start another from" });
    return;
  }

  const inheritError = inheritFromError(card, newSession, inheritFrom);
  if (inheritError != null) {
    res.status(409).json({ error: inheritError });
    return;
  }

  const config = getOrchestrationConfig();
  if (!config) {
    res
      .status(400)
      .json({ error: "orchestration config is not loaded", variant: "config" });
    return;
  }

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

  void startSession(id, extraDirection, config, {
    playbook,
    newSession,
    inheritFrom,
  });
  res.status(202).json({ started: true });
});

cardsRouter.post("/cards/:id/resume", (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }
  const groupError = groupedMemberError(card);
  if (groupError != null) {
    res.status(409).json({ error: groupError });
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
  const groupError = groupedMemberError(card);
  if (groupError != null) {
    res.status(409).json({ error: groupError });
    return;
  }

  if (!card.tmuxSession || !card.activeSessionId) {
    res.status(400).json({ error: "card has no live session" });
    return;
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    res
      .status(400)
      .json({ error: `invalid ticket identifier: ${card.identifier}` });
    return;
  }

  void ensureTerminal(card.id, card.activeSessionId, card.tmuxSession);
  res.status(202).json({ ensuring: true });
});

cardsRouter.post("/cards/:id/session", async (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }
  const groupError = groupedMemberError(card);
  if (groupError != null) {
    res.status(409).json({ error: groupError });
    return;
  }

  const sessionId = (req.body as { sessionId?: unknown } | undefined)
    ?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") {
    res.status(400).json({ error: "invalid sessionId" });
    return;
  }

  if (!card.sessions?.some((s) => s.id === sessionId)) {
    res
      .status(400)
      .json({ error: `session ${sessionId} does not resolve for this card` });
    return;
  }

  await store.switchActiveSession(id, sessionId);
  res.status(202).json({ switched: true });
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
  const groupError = groupedMemberError(card);
  if (groupError != null) {
    res.status(409).json({ error: groupError });
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
  const groupError = groupedMemberError(card);
  if (groupError != null) {
    res.status(409).json({ error: groupError });
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
  if (store.isCleaningUp(id)) {
    res
      .status(409)
      .json({ error: "cleanup is already in flight for this card" });
    return;
  }

  const force = (req.body as { force?: unknown } | undefined)?.force === true;
  store.beginCleanup(id);
  void runCleanupFanOut(id, force).finally(() => store.endCleanup(id));
  res.status(202).json({ cleaning: true });
});

/**
 * Fans a single manual `/cleanup` click out over EVERY session the card owns (USER DECISION,
 * `93-CONTEXT.md`): one mental model for "clean up this ticket", matching what reaching Done
 * already schedules. Deliberately sequential (never `Promise.all`) with a per-session `try/catch`
 * so a throw from one session's teardown cannot abort siblings that already succeeded — the
 * blocked and warned outcomes are recorded terminal branches inside `cleanupWorkspace` that return
 * normally, not throws, so partial success falls out of the loop naturally. The card and its
 * session list are re-read fresh on every iteration because the card can leave Done mid-fan-out
 * and a session can already have been removed by the scheduler's own concurrent tick. The
 * in-flight guard (`beginCleanup`/`endCleanup`) stays card-scoped for the WHOLE fan-out by locked
 * decision, so it is begun/ended once by the caller, not per iteration.
 */
async function runCleanupFanOut(id: string, force: boolean): Promise<void> {
  const card = store.getCard(id);
  const sessionIds = (card?.sessions ?? []).map((s) => s.id);
  const targets: (string | undefined)[] =
    sessionIds.length > 0 ? sessionIds : [undefined];
  for (const sid of targets) {
    const fresh = store.getCard(id);
    if (!fresh || fresh.column !== "done") break;
    if (sid !== undefined && !fresh.sessions?.some((s) => s.id === sid))
      continue;
    try {
      await cleanupWorkspace(id, sid, { force });
    } catch (err) {
      console.error(
        `[cleanup] failed for card ${id}, session ${sid ?? "(active)"}:`,
        (err as Error).message,
      );
    }
  }
}

/**
 * Server-side re-validation for a `POST /cards/group` member id: the client's `GroupStartModal`
 * selection is a frozen snapshot, so every id is re-checked against the LIVE store at submit time,
 * never trusted (a TOCTOU defense — a member could be started/removed/grouped elsewhere between
 * selection and submit). Distinct from `inboxTransitionError`'s shape (returns the FIRST failing
 * id's reason via the caller's loop) since the route must collect every offending id for the 409
 * `ineligibleIds` list, not just fail fast on the first.
 */
function memberIneligibleReason(card: Card | undefined): string | null {
  if (!card) return "unknown card id";
  if (card.column !== "todo") return "not in To Do";
  if (card.groupId != null) return "already grouped";
  if (card.source === "group") return "is itself a group";
  return null;
}

/**
 * Atomic group create+start (Phase 63, GROUP-01/03/04): validates `title` (MAX_TITLE_LEN +
 * marker screening, the `POST /cards` precedent) and `memberIds` (>=2, distinct, each
 * re-validated live via {@link memberIneligibleReason} as a fast pre-check AND re-checked a
 * second time INSIDE the store's mutation queue by `createGroupCard`, which refuses the whole
 * mint if any member was raced ineligible — all-or-nothing 409 per the ratified
 * ALL-OR-NOTHING posture, Open Question 3), replicates `/cards/:id/start`'s exact
 * playbook/workspace/base-branch/restatRepos checks (the workspace payload is REQUIRED here — a
 * brand-new group card has no prior `card.workspace` to fall back to), then mints the group card
 * and calls the UNMODIFIED `startSession` keyed by its id — the saga itself needs zero
 * group-awareness (it only ever reads `card.workspace`/`card.identifier`).
 * @remarks The 202 body passes the card through {@link redactCard}, never the live `Map` entry.
 * By the time this responds, `setCardWorkspace` has already minted the card's first session
 * record, so serializing the live object would put the whole `sessions` array on the wire — and
 * the per-session `hookToken` with it the moment `startSession`'s internal `await` placement
 * changes. A secret boundary must not depend on the scheduling of a `void`-ed promise in another
 * module, so every card-emitting route reaches the wire through the one redaction chokepoint.
 */
async function createGroupHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as
    | {
        title?: unknown;
        memberIds?: unknown;
        folder?: unknown;
        repos?: unknown;
        playbook?: unknown;
        extraDirection?: unknown;
      }
    | undefined;

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (title === "" || title.length > MAX_TITLE_LEN) {
    res.status(400).json({ error: "invalid-title" });
    return;
  }
  if (hasDispatchMarker(title)) {
    res
      .status(400)
      .json({ error: "content contains the DISPATCH_STATUS marker" });
    return;
  }

  const rawMemberIds = body?.memberIds;
  if (
    !Array.isArray(rawMemberIds) ||
    rawMemberIds.length < 2 ||
    !rawMemberIds.every((id) => typeof id === "string") ||
    new Set(rawMemberIds).size !== rawMemberIds.length
  ) {
    res.status(400).json({
      error: "memberIds must be an array of >=2 distinct card ids",
    });
    return;
  }
  const memberIds = rawMemberIds;

  const ineligibleIds = memberIds.filter(
    (id) => memberIneligibleReason(store.getCard(id)) != null,
  );
  if (ineligibleIds.length > 0) {
    res.status(409).json({
      error: "some selected cards are no longer eligible to be grouped",
      ineligibleIds,
    });
    return;
  }

  const config = getOrchestrationConfig();
  if (!config) {
    res
      .status(400)
      .json({ error: "orchestration config is not loaded", variant: "config" });
    return;
  }

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
  if (!hasWorkspacePayload) {
    res.status(400).json({
      error: "No workspace selected for this group",
      variant: "config",
    });
    return;
  }

  const repos = (rawRepos as { path: string; base: string }[]).map((r) => ({
    path: r.path,
    base: r.base,
  }));
  if (repos.some((r) => r.base.startsWith("-"))) {
    res.status(400).json({ error: "invalid base branch", variant: "config" });
    return;
  }
  if (!(await restatRepos(repos))) {
    res.status(400).json({
      error: "Can't start — a selected repo is missing",
      variant: "config",
    });
    return;
  }

  const extraDirection =
    typeof body?.extraDirection === "string" ? body.extraDirection : "";

  const groupResult = await store.createGroupCard(title, memberIds);
  if (!groupResult.ok) {
    res.status(409).json({
      error: "some selected cards are no longer eligible to be grouped",
      ineligibleIds: groupResult.ineligibleIds,
    });
    return;
  }
  const groupCard = groupResult.card;
  await store.setCardWorkspace(groupCard.id, { folder, repos });
  void startSession(groupCard.id, extraDirection, config, { playbook });
  res.status(202).json({ started: true, card: redactCard(groupCard) });
}

cardsRouter.post("/cards/group", createGroupHandler);

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

/**
 * The one in-flight `POST /cards/group-title` generation, shared by every caller waiting on the
 * SAME member set. `key` is the sorted member-id list; `waiters` counts the responses still
 * connected and expecting this run's phrase.
 */
interface GroupTitleRun {
  key: string;
  controller: AbortController;
  promise: Promise<string>;
  waiters: number;
}

/**
 * Module-level single-flight state for `POST /cards/group-title` (`ORCH-05`), DELIBERATELY its OWN
 * state — never shared with `draftInFlight` above: the two draft-generation surfaces (a local
 * ticket draft, a group title phrase) are unrelated features a user could legitimately have open
 * at once, mirroring that precedent's own split from `playbooks.route.ts`'s `generateInFlight`.
 * A concurrent call for a DIFFERENT member set still gets a 409 rather than fanning out parallel
 * `claude -p` subprocesses; a concurrent call for the SAME member set JOINS the run in flight.
 *
 * @remarks Joining, rather than rejecting, is what makes this route usable from a modal-mount
 * effect. React StrictMode mounts, unmounts and remounts in a single commit, so the development
 * build issues a request, aborts it about a millisecond later, and issues its replacement — and the
 * replacement is the one whose result the user would actually see. A plain single-flight boolean
 * rejected that replacement with a 409 and the client silently kept its deterministic fallback, so
 * a generated title never landed at all. Releasing the boolean from the disconnect handler instead
 * of the settle handler was measured and is NOT sufficient: it only wins when the aborted request's
 * socket close is processed before the replacement's request arrives, which on loopback is a coin
 * flip (measured 5/10). Joining removes the ordering question entirely — either the replacement
 * finds the run and rides it, or it finds none and starts its own, and both outcomes are a 200.
 * The two-tab and close-then-reopen paths have the same shape and are fixed by the same property.
 * @remarks The subprocess-fan-out defence is strictly preserved: one member set, one `claude`. The
 * run is aborted as soon as its LAST waiter disconnects, so closing the modal still kills the
 * subprocess rather than letting it hold the slot for its full timeout.
 * @remarks Joined waiters receive the phrase computed from the FIRST caller's card snapshot. The
 * key is the member-id set, not the resolved titles, so a store mutation landing between two joined
 * requests yields a phrase describing the marginally older titles. That is deliberate: the phrase
 * is an editable suggestion, and the window is the few milliseconds between a request and its
 * StrictMode replacement.
 * @remarks Abort listens on `res`, NOT `req` — `req.on("close")` fires the instant the request
 * body is fully read, well before any response is sent, which is exactly the bug `draftInFlight`'s
 * own JSDoc above records as having silently aborted every real `/cards/draft` invocation until it
 * was fixed. This route is written correctly from its first commit.
 */
let groupTitleRun: GroupTitleRun | null = null;

cardsRouter.post("/cards/group-title", (req, res) => {
  const rawMemberIds = (req.body as { memberIds?: unknown } | undefined)
    ?.memberIds;
  if (
    !Array.isArray(rawMemberIds) ||
    rawMemberIds.length < 2 ||
    rawMemberIds.length > MAX_GROUP_TITLE_MEMBERS ||
    !rawMemberIds.every((id) => typeof id === "string") ||
    new Set(rawMemberIds).size !== rawMemberIds.length
  ) {
    res.status(400).json({ error: "invalid-member-ids" });
    return;
  }

  const members: GroupTitleMember[] = rawMemberIds
    .map((id) => store.getCard(id))
    .filter((card): card is Card => card !== undefined)
    .map((card) => ({
      identifier: card.identifier,
      title: card.title,
      project: card.project?.name ?? null,
    }));
  if (members.length < 2) {
    res.status(400).json({ error: "invalid-member-ids" });
    return;
  }

  const key = [...rawMemberIds].sort().join(",");
  if (groupTitleRun !== null && groupTitleRun.key !== key) {
    res.status(409).json({ error: "generate-in-progress" });
    return;
  }

  if (groupTitleRun === null) {
    const controller = new AbortController();
    const started: GroupTitleRun = {
      key,
      controller,
      waiters: 0,
      promise: generateGroupTitlePhrase(members, controller.signal),
    };
    void started.promise
      .catch(() => undefined)
      .finally(() => {
        if (groupTitleRun === started) groupTitleRun = null;
      });
    groupTitleRun = started;
  }

  const run = groupTitleRun;
  run.waiters++;
  let disconnected = false;
  res.on("close", () => {
    if (res.writableEnded) return;
    disconnected = true;
    run.waiters--;
    if (run.waiters > 0) return;
    run.controller.abort();
    if (groupTitleRun === run) groupTitleRun = null;
  });

  run.promise
    .then((phrase) => {
      if (disconnected) return;
      res.status(200).json({ phrase });
    })
    .catch((err) => {
      if (disconnected) return;
      console.warn(
        "[cards/group-title] generation failed:",
        (err as Error).message,
      );
      res.status(502).json({ error: "generate-failed" });
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
  res.status(201).json(redactCard(card));
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
 * -> already behind the single app-level gate hoisted in `bootstrap/index.ts` (loopback OR a valid
 * remote session) — no new gate code needed here. Uses a 404 for an unknown card id, a DELIBERATE
 * deviation from this file's other routes' 400-for-unknown-card (documented per the RESEARCH
 * contract). The per-card single-flight
 * guard follows the `isStarting` discipline EXACTLY: `store.isSyncing` is checked and
 * `store.beginSync` is called SYNCHRONOUSLY with no `await` between them, so a concurrent request
 * for the SAME card can never race past the guard; a DIFFERENT card's sync is unaffected (the guard
 * is keyed by card id, never a global flag). The subprocess call carries NO abort-on-disconnect
 * wiring — the service's own no-signal decision — so the server owns the full timeout bound and a
 * client disconnect can never orphan a created-but-unadopted Linear issue mid-flight. The 200 body
 * passes the card through `redactCard()` — the same redaction applied by `snapshot()`, reached
 * directly rather than by building a whole board to find one card — never the live Map entry, so a
 * started local card's `hookToken` can never ride the response (SECURITY).
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
  const groupError = groupedMemberError(card);
  if (groupError != null) {
    res.status(409).json({ error: groupError });
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
    const updated = store.getCard(id);
    res.status(200).json(updated ? redactCard(updated) : undefined);
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
