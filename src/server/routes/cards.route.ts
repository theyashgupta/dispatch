import path from "node:path";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Card } from "../../shared/types.js";
import {
  redactArchivedGroup,
  redactCard,
  boardRepository as store,
} from "../store/board-repository.js";
import { startSession } from "../services/orchestration/start-session.js";
import {
  createGroup,
  startGroup,
} from "../services/orchestration/group-launch.js";
import { restatRepos } from "../services/orchestration/workspaces.js";
import { createTicket } from "../services/orchestration/ticket-create.js";
import {
  reconnectTerminal,
  resumeSession,
} from "../services/orchestration/resume-session.js";
import { cleanupWorkspace } from "../services/orchestration/cleanup.js";
import {
  actionableCard,
  groupedMemberError,
  moveCard,
} from "../services/orchestration/card-move.js";
import { unwindGroup } from "../services/orchestration/unwind.js";
import { resetCard } from "../services/orchestration/reset.js";
import { runClaude } from "../services/orchestration/run-claude.js";
import { moveOrQueue } from "../services/orchestration/session-account-apply.js";
import { editorPath, launchEditor } from "../adapters/editors.js";
import { getOrchestrationConfig } from "../services/infra/config-holder.js";
import {
  loadPlaybooks,
  hasDispatchMarker,
} from "../services/infra/playbooks.js";
import {
  ConflictError,
  HttpError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "../services/domain/errors.js";
import { generateTicketDraft } from "../services/orchestration/ticket-generate.js";
import {
  generateGroupTitlePhrase,
  type GroupTitleMember,
} from "../services/orchestration/group-title-generate.js";
import {
  syncCard,
  syncViaClaude,
} from "../services/orchestration/linear-sync.js";
import {
  assignToMe,
  moveLinearState,
  postComment,
} from "../services/orchestration/linear-outbound.js";
import { attachmentsDir } from "../services/infra/paths.js";
import { enabledSource } from "../adapters/source-gateway.js";
import {
  attachmentParamsSchema,
  cardListQuerySchema,
  commentBodySchema,
  createCardBodySchema,
  createGroupBodySchema,
  draftBodySchema,
  groupTitleBodySchema,
  linearStateBodySchema,
  moveBodySchema,
  openEditorBodySchema,
  sessionAccountBodySchema,
  sessionBodySchema,
  startBodySchema,
  syncBodySchema,
  unwindBodySchema,
} from "./cards-schemas.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import { forceBodySchema } from "./schema-primitives.js";
import {
  listBoardCards,
  resolveBoard,
  resolveBoardForCreate,
} from "../services/orchestration/boards.js";
import { parseBoardParam } from "./boards-schemas.js";

export const cardsRouter = Router();

/**
 * `GET /api/cards/:id` — a single-card fetch for a search result outside the loaded window
 * (SCALE-03). Answers an unknown id exactly the way `/move`, `/start`, `/resume`, `/terminal`,
 * `/open-editor`, and `/cleanup` already do in THIS file, a plain 400, a
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
  if (!card) throw new ValidationError(`unknown card id: ${id}`);
  const members =
    card.source === "group" ? store.membersOf(card.id).map(redactCard) : [];
  res.status(200).json({ card: redactCard(card), members });
}

cardsRouter.get("/cards/:id", getCardById);

cardsRouter.get("/cards", (req, res) => {
  const { key } = resolveBoard(parseBoardParam(req.query));
  res
    .status(200)
    .json(listBoardCards(key, parseOrThrow(cardListQuerySchema, req.query)));
});

cardsRouter.get("/cards/:id/comments", (req, res) => {
  const card = store.getCard(req.params.id);
  if (!card) throw new NotFoundError(`unknown card id: ${req.params.id}`);
  res.status(200).json({ comments: card.comments ?? [] });
});

cardsRouter.post("/cards/:id/comment", async (req, res) => {
  const { body } = parseOrThrow(commentBodySchema, req.body);
  const outcome = await postComment(req.params.id, body);
  if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
  res.status(201).json({ ok: true });
});

cardsRouter.post("/cards/:id/assign-me", async (req, res) => {
  const outcome = await assignToMe(req.params.id);
  if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
  res.status(204).end();
});

cardsRouter.post("/cards/:id/linear-state", async (req, res) => {
  const { stateId } = parseOrThrow(linearStateBodySchema, req.body);
  const outcome = await moveLinearState(req.params.id, stateId);
  if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
  res.status(204).end();
});

cardsRouter.post("/cards/:id/move", async (req, res) => {
  const { column } = parseOrThrow(moveBodySchema, req.body);
  await moveCard(req.params.id, column);
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
  const { extraDirection, playbook, newSession, inheritFrom, workspace } =
    parseOrThrow(startBodySchema, req.body);

  const card = actionableCard(id);

  if (card.column === "done") {
    throw new ConflictError("cannot start a session for a Done card");
  }

  if (card.column === "inbox") {
    throw new ConflictError(
      "cannot start a session from the Inbox: promote to To Do first",
    );
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    throw new ValidationError(`invalid ticket identifier: ${card.identifier}`);
  }

  if (
    newSession &&
    !card.sessions?.some((s) => s.id === card.activeSessionId)
  ) {
    throw new ConflictError("no existing session to start another from");
  }

  const inheritError = inheritFromError(card, newSession, inheritFrom);
  if (inheritError != null) throw new ConflictError(inheritError);

  const config = getOrchestrationConfig();
  if (!config) {
    throw new ValidationError("orchestration config is not loaded", {
      variant: "config",
    });
  }

  if (playbook !== undefined) {
    const known = (await loadPlaybooks()).some((p) => p.name === playbook);
    if (!known) {
      throw new ValidationError("unknown playbook", { variant: "playbook" });
    }
  }

  if (workspace) {
    if (workspace.repos.some((r) => r.base.startsWith("-"))) {
      throw new ValidationError("invalid base branch", { variant: "config" });
    }
    if (!(await restatRepos(workspace.repos))) {
      throw new ValidationError("Can't start: a selected repo is missing", {
        variant: "config",
      });
    }
    await store.setCardWorkspace(id, workspace);
  } else if (!card.workspace) {
    throw new ValidationError("No workspace selected for this ticket", {
      variant: "config",
    });
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

  const card = actionableCard(id);

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    throw new ValidationError(`invalid ticket identifier: ${card.identifier}`);
  }

  if (!card.workspacePath) {
    throw new ValidationError("card has no workspace to resume");
  }

  if (card.tmuxSession) throw new ConflictError("session is already live");

  const activeRecord = card.sessions?.some(
    (s) => s.id === card.activeSessionId,
  );
  if (card.sessionLost !== true && activeRecord !== true) {
    throw new ConflictError("card has no lost session to resume");
  }

  if (store.isStarting(id)) {
    throw new ConflictError("a start is in flight for this card");
  }

  void resumeSession(id);
  res.status(202).json({ resuming: true });
});

cardsRouter.post("/cards/:id/terminal", (req, res) => {
  const { id } = req.params;

  const card = actionableCard(id);

  if (!card.tmuxSession || !card.activeSessionId) {
    throw new ValidationError("card has no live session");
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    throw new ValidationError(`invalid ticket identifier: ${card.identifier}`);
  }

  void reconnectTerminal(card.id);
  res.status(202).json({ ensuring: true });
});

cardsRouter.post("/cards/:id/run-claude", async (req, res) => {
  const { id } = req.params;

  const card = actionableCard(id);

  if (!card.tmuxSession || !card.activeSessionId) {
    throw new ValidationError("card has no live session");
  }

  const outcome = await runClaude(card.id);
  if (outcome === "busy") {
    throw new ConflictError("the terminal is not at a shell prompt");
  }
  if (outcome === "legacy") {
    throw new ConflictError(
      "this session was started by an older Dispatch; it becomes a shell session after Claude exits and Resume runs",
    );
  }
  if (outcome === "account") {
    throw new ConflictError(
      "the session's Claude account is no longer available",
    );
  }
  if (outcome === "no-session") {
    throw new ValidationError("card has no live session");
  }
  res.status(202).json({ launched: true });
});

cardsRouter.post("/cards/:id/session/account", async (req, res) => {
  const { accountId, sessionId } = parseOrThrow(
    sessionAccountBodySchema,
    req.body,
  );
  if (!store.getCard(req.params.id)) throw new NotFoundError("not-found");
  const outcome = await moveOrQueue(req.params.id, accountId, sessionId);
  if (outcome === "account") throw new NotFoundError("not-found");
  if (outcome === "queued") {
    res.status(202).json({ outcome });
    return;
  }
  if (outcome === "moved" || outcome === "same") {
    res.status(200).json({ outcome });
    return;
  }
  throw new ConflictError(outcome);
});

cardsRouter.post("/cards/:id/session", async (req, res) => {
  const { id } = req.params;

  const card = actionableCard(id);

  const { sessionId } = parseOrThrow(sessionBodySchema, req.body);

  if (!card.sessions?.some((s) => s.id === sessionId)) {
    throw new ValidationError(
      `session ${sessionId} does not resolve for this card`,
    );
  }

  await store.switchActiveSession(id, sessionId);
  res.status(202).json({ switched: true });
});

cardsRouter.post("/cards/:id/open-editor", (req, res) => {
  const { id } = req.params;

  const { editor } = parseOrThrow(openEditorBodySchema, req.body);

  if (editorPath(editor) == null) {
    throw new ValidationError(`editor "${editor}" is not available`);
  }

  const card = actionableCard(id);

  if (!card.workspacePath) throw new ValidationError("card has no workspace");

  void launchEditor(editor, card.workspacePath).catch((err) => {
    console.error(`[open-editor] launch failed for card ${id}:`, err);
  });
  res.status(204).end();
});

cardsRouter.post("/cards/:id/cleanup", (req, res) => {
  const { id } = req.params;

  const card = actionableCard(id);
  if (card.column !== "done") {
    throw new ConflictError("cleanup is only available for Done cards");
  }
  if (store.isStarting(id)) {
    throw new ConflictError("a start is in flight for this card");
  }
  if (store.isCleaningUp(id)) {
    throw new ConflictError("cleanup is already in flight for this card");
  }

  const { force } = forceBodySchema.parse(req.body);
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
 * `POST /cards/group`: create a group card from To Do members and start its session.
 *
 * @remarks The 202 body passes the card through {@link redactCard}, never the live `Map` entry, so
 * no session `hookToken` reaches the wire. The service owns every guard and their order.
 */
async function createGroupHandler(req: Request, res: Response): Promise<void> {
  const { title, memberIds, playbook, extraDirection, workspace } =
    parseOrThrow(createGroupBodySchema, req.body);
  const { key: board } = resolveBoardForCreate(parseBoardParam(req.query));
  const card = await createGroup(board, {
    title,
    memberIds,
    playbook,
    workspace,
  });
  void startGroup(card.id, { extraDirection, playbook });
  res.status(202).json({ started: true, card: redactCard(card) });
}

/**
 * `POST /cards/:id/unwind` (LOCAL-17): take a group apart from the group card or any member.
 * @remarks `to` picks where the members land, To Do by default or the Inbox. The service owns
 * every guard; this handler validates the body and maps the outcome to a status.
 * @see docs/ARCHITECTURE.md#unwind-and-archive
 */
async function unwindHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const { to } = parseOrThrow(unwindBodySchema, req.body);
  const outcome = await unwindGroup(id, to);
  if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
  res.status(200).json({ archived: redactArchivedGroup(outcome.row) });
}

cardsRouter.post("/cards/:id/unwind", unwindHandler);

/**
 * `POST /cards/:id/reset` (LOCAL-20): undo a start. The card returns to the Inbox with no session,
 * workspace or local branch. The service owns every guard; this handler maps the outcome.
 * @see docs/ARCHITECTURE.md#reset
 */
async function resetHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const outcome = await resetCard(id);
  if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
  res.status(200).json({ reset: true });
}

cardsRouter.post("/cards/:id/reset", resetHandler);

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
 * response (the catch block returns early on an aborted signal instead of throwing the
 * `UpstreamError`), so the client hung until its own timeout. `res.on("close")` only fires when
 * the underlying connection ends WITHOUT the response having been fully written, which is what
 * "the client disconnected before generation finished" actually means; the existing
 * `!res.writableEnded` guard still excludes the normal-completion case.
 */
let draftInFlight = false;

cardsRouter.post("/cards/draft", async (req, res) => {
  const { direction, images } = parseOrThrow(draftBodySchema, req.body);

  if (draftInFlight) throw new ConflictError("generate-in-progress");

  draftInFlight = true;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const draft = await generateTicketDraft(
      direction,
      controller.signal,
      images,
    );
    if (controller.signal.aborted) return;
    res.status(200).json(draft);
  } catch (err) {
    if (controller.signal.aborted) return;
    console.warn("[cards/draft] generation failed:", (err as Error).message);
    throw new UpstreamError("generate-failed");
  } finally {
    draftInFlight = false;
  }
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

cardsRouter.post("/cards/group-title", async (req, res) => {
  const { memberIds } = parseOrThrow(groupTitleBodySchema, req.body);

  const members: GroupTitleMember[] = memberIds
    .map((id) => store.getCard(id))
    .filter((card): card is Card => card !== undefined)
    .map((card) => ({
      identifier: card.identifier,
      title: card.title,
      project: card.project?.name ?? null,
    }));
  if (members.length < 2) throw new ValidationError("invalid-member-ids");

  const key = [...memberIds].sort().join(",");
  if (groupTitleRun !== null && groupTitleRun.key !== key) {
    throw new ConflictError("generate-in-progress");
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

  try {
    const phrase = await run.promise;
    if (disconnected) return;
    res.status(200).json({ phrase });
  } catch (err) {
    if (disconnected) return;
    console.warn(
      "[cards/group-title] generation failed:",
      (err as Error).message,
    );
    throw new UpstreamError("generate-failed");
  }
});

cardsRouter.post("/cards", async (req, res) => {
  const { title, fullDescription, images } = parseOrThrow(
    createCardBodySchema,
    req.body,
  );
  const { key: board } = resolveBoardForCreate(parseBoardParam(req.query));

  const card = await createTicket(board, { title, fullDescription, images });
  res.status(201).json(redactCard(card));
});

/**
 * Serve one stored attachment from the card's own folder.
 *
 * @remarks Both params are regex-checked, the resolved path must stay under the card folder, and
 * the file is sent with the `root` option, so the request can never name a path outside
 * `attachmentsDir(id)`.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
function serveAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { id, name } = parseOrThrow(attachmentParamsSchema, req.params);
  const dir = attachmentsDir(id);
  const file = path.resolve(dir, name);
  if (!file.startsWith(dir + path.sep)) {
    throw new ValidationError("invalid-attachment");
  }
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  res.sendFile(path.basename(file), { root: dir, dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) next(new NotFoundError("not-found"));
  });
}

cardsRouter.get("/cards/:id/attachments/:name", serveAttachment);

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
 * is keyed by card id, never a global flag). The sync call (direct or Claude path) carries NO abort-on-disconnect
 * wiring — the service's own no-signal decision — so the server owns the full timeout bound and a
 * client disconnect can never orphan a created-but-unadopted Linear issue mid-flight. The 200 body
 * passes the card through `redactCard()` — the same redaction applied by `snapshot()`, reached
 * directly rather than by building a whole board to find one card — never the live Map entry, so a
 * started local card's `hookToken` can never ride the response (SECURITY).
 * The direct path (the default) needs a `teamId` in the body (400 otherwise) and a connected
 * Linear source (409 "Linear is not connected").
 */
async function syncLinearHandler(
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const { id } = req.params;
  const target = parseOrThrow(syncBodySchema, req.body);

  const card = store.getCard(id);
  if (!card) throw new NotFoundError(`unknown card id: ${id}`);
  const groupError = groupedMemberError(card);
  if (groupError != null) throw new ConflictError(groupError);

  if ((card.source ?? "linear") !== "local") {
    throw new ConflictError("only local tickets can be synced to Linear");
  }

  if (store.isSyncing(id)) {
    throw new ConflictError("a sync is already in flight for this card");
  }

  const viaClaude = syncViaClaude();
  if (!target && !viaClaude) throw new ValidationError("teamId is required");
  if (!viaClaude && !enabledSource("linear")?.createIssue) {
    throw new ConflictError("Linear is not connected");
  }

  store.beginSync(id);
  void store.setSyncing(id, true);

  try {
    const result = await syncCard(
      {
        id: card.id,
        title: card.title,
        description: card.description,
        priority: card.priority,
      },
      target,
    );

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
      "Sync to Linear failed. Retrying is safe, no duplicate will be created.",
    );
    throw new UpstreamError("sync-failed");
  } finally {
    store.endSync(id);
  }
}

cardsRouter.post("/cards/:id/sync-linear", syncLinearHandler);

cardsRouter.use(httpErrorHandler);
