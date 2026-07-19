import { Router } from "express";
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
import { loadPlaybooks } from "../services/domain/playbooks.js";

export const cardsRouter = Router();

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
