import {
  columnPushes,
  resolveTargetState,
} from "../../../shared/linear-state-map.js";
import type {
  Column,
  ColumnChange,
  LinearWorkflow,
} from "../../../shared/types.js";
import { pollNow } from "../../adapters/poller.js";
import {
  enabledSource,
  type TicketSource,
} from "../../adapters/source-gateway.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { outboundErrorCopy } from "./outbound-error.js";

export type OutboundOutcome =
  { ok: true } | { ok: false; status: 400 | 404 | 409 | 502; error: string };

type PushResult = { ok: true } | { ok: false; error: string };

export interface OutboundDeps {
  source: (sourceId: string) => TicketSource | undefined;
  poll: (sourceId: string) => boolean;
  now: () => number;
}

const LIVE: OutboundDeps = {
  source: enabledSource,
  poll: pollNow,
  now: Date.now,
};

const WORKFLOW_TTL_MS = 300_000;

let workflowCache: { at: number; value: LinearWorkflow } | undefined;

/**
 * Run one Linear write for a card and record its outcome on the card.
 *
 * @remarks `write` returns undefined when the source lacks the method, which answers 409; a
 * failure stores the fixed copy as `linearError` and a success clears it and polls.
 */
async function writeLinear(
  cardId: string,
  verb: string,
  deps: OutboundDeps,
  write: (source: TicketSource, issueId: string) => Promise<void> | undefined,
): Promise<OutboundOutcome> {
  const card = store.getCard(cardId);
  if (!card) {
    return { ok: false, status: 404, error: `unknown card id: ${cardId}` };
  }
  const source =
    (card.source ?? "linear") === "linear" ? deps.source("linear") : undefined;
  const pending = source ? write(source, card.issueId) : undefined;
  if (!pending) {
    return { ok: false, status: 409, error: `source cannot ${verb}` };
  }
  try {
    await pending;
  } catch (err) {
    const copy = outboundErrorCopy(err);
    await store.setLinearError(cardId, copy);
    return { ok: false, status: 502, error: copy };
  }
  await store.setLinearError(cardId, null);
  deps.poll("linear");
  return { ok: true };
}

/** Post a comment on a Linear card and refresh the board through a poll. */
export function postComment(
  cardId: string,
  body: string,
  deps: OutboundDeps = LIVE,
): Promise<OutboundOutcome> {
  return writeLinear(cardId, "comment", deps, (source, issueId) =>
    source.addComment?.(issueId, body),
  );
}

/** Assign a Linear card's issue to the viewer and refresh the board through a poll. */
export function assignToMe(
  cardId: string,
  deps: OutboundDeps = LIVE,
): Promise<OutboundOutcome> {
  return writeLinear(cardId, "assign", deps, (source, issueId) =>
    source.viewerId && source.assignIssue
      ? source
          .viewerId()
          .then((viewer) => source.assignIssue?.(issueId, viewer))
      : undefined,
  );
}

/**
 * The viewer and the teams with their states, cached for five minutes.
 *
 * @remarks A disabled or keyless source answers 409 and a Linear failure is never cached.
 */
export async function getWorkflow(
  deps: OutboundDeps = LIVE,
): Promise<
  | { ok: true; workflow: LinearWorkflow }
  | { ok: false; status: 409 | 502; error: string }
> {
  const source = deps.source("linear");
  if (!source?.workflow) {
    return { ok: false, status: 409, error: "Linear is not connected" };
  }
  if (workflowCache && deps.now() - workflowCache.at < WORKFLOW_TTL_MS) {
    return { ok: true, workflow: workflowCache.value };
  }
  try {
    const value = await source.workflow();
    workflowCache = { at: deps.now(), value };
    return { ok: true, workflow: value };
  } catch (err) {
    return { ok: false, status: 502, error: outboundErrorCopy(err) };
  }
}

/** Drop the cached workflow so the next read fetches it again. */
export function invalidateWorkflow(): void {
  workflowCache = undefined;
}

export interface ColumnSnapshot {
  id: string;
  column: Column;
}

const pushChains = new Map<string, Promise<void>>();

/** Record a failed state push as the card notice and event, and answer the failure. */
async function recordPushFailure(
  cardId: string,
  fromCol: Column,
  toCol: Column,
  copy: string,
): Promise<{ ok: false; error: string }> {
  const error = `Linear state not updated. ${copy}`;
  await store.recordLinearPush(cardId, {
    ok: false,
    copy: error,
    fromCol,
    toCol,
  });
  return { ok: false, error };
}

/** The columns of a card and its mirrored members, read before a move. */
export function snapshotColumns(cardId: string): ColumnSnapshot[] {
  const ids = [cardId, ...(store.getCard(cardId)?.memberIds ?? [])];
  return ids.flatMap((id) => {
    const card = store.getCard(id);
    return card ? [{ id, column: card.column }] : [];
  });
}

/** The column changes since a snapshot, read from the live cards. */
export function columnChangesSince(
  before: readonly ColumnSnapshot[],
): ColumnChange[] {
  return before.flatMap(({ id, column: fromCol }) => {
    const toCol = store.getCard(id)?.column;
    return toCol && toCol !== fromCol ? [{ id, fromCol, toCol }] : [];
  });
}

/**
 * Queue a state push for every changed Linear card with a team.
 *
 * @remarks Callers do not await it: the move answers at once and each card's pushes run in order.
 */
export function pushColumnChanges(
  changes: readonly ColumnChange[],
  deps: OutboundDeps = LIVE,
): Promise<void> {
  const runs = changes.flatMap(({ id, fromCol, toCol }) => {
    const card = store.getCard(id);
    if (!card?.team || (card.source ?? "linear") !== "linear") return [];
    return [
      chainPush(id, () => pushState(id, fromCol, toCol, undefined, deps)),
    ];
  });
  return Promise.all(runs).then(() => undefined);
}

/** Push a chosen state for a card without a map lookup, in order with its other pushes. */
export async function setLinearState(
  cardId: string,
  stateId: string,
  deps: OutboundDeps = LIVE,
): Promise<PushResult> {
  const column = store.getCard(cardId)?.column;
  if (!column) return { ok: true };
  const result = await chainPush(cardId, () =>
    pushState(cardId, column, column, stateId, deps),
  );
  return result ?? recordPushFailure(cardId, column, column, "Try again.");
}

/**
 * Check a chosen Linear state against the card's team, then push it in order with the card's pushes.
 *
 * @remarks Every refusal happens before the per-card chain, so a refused request never sends a
 * write; a workflow read failure is recorded like any failed push so the card shows the notice.
 */
export async function moveLinearState(
  cardId: string,
  stateId: string,
  deps: OutboundDeps = LIVE,
): Promise<OutboundOutcome> {
  const card = store.getCard(cardId);
  if (!card) {
    return { ok: false, status: 404, error: `unknown card id: ${cardId}` };
  }
  const teamId = card.team?.id;
  if ((card.source ?? "linear") !== "linear" || !teamId) {
    return {
      ok: false,
      status: 409,
      error: "only a Linear card with a team has Linear states",
    };
  }
  const source = deps.source("linear");
  if (!source?.updateState || !source.workflow) {
    return { ok: false, status: 409, error: "Linear is not connected" };
  }
  const workflow = await getWorkflow(deps);
  if (!workflow.ok) {
    const failed = await recordPushFailure(
      cardId,
      card.column,
      card.column,
      workflow.error,
    );
    return { ok: false, status: 502, error: failed.error };
  }
  const states =
    workflow.workflow.teams.find((t) => t.id === teamId)?.states ?? [];
  if (!states.some((st) => st.id === stateId)) {
    return {
      ok: false,
      status: 400,
      error: "stateId is not a state of the card's team",
    };
  }
  const pushed = await setLinearState(cardId, stateId, deps);
  return pushed.ok ? pushed : { ok: false, status: 502, error: pushed.error };
}

/** Run `push` after every earlier push for the same card has settled. */
function chainPush<T>(
  cardId: string,
  push: () => Promise<T>,
): Promise<T | undefined> {
  const next = (pushChains.get(cardId) ?? Promise.resolve())
    .then(push)
    .catch((err: unknown): undefined => {
      console.warn(
        `[linear-push] push for card ${cardId} failed:`,
        (err as Error).message,
      );
      return undefined;
    });
  const settled = next.then(() => undefined);
  pushChains.set(cardId, settled);
  store.setPushing(cardId, true);
  void settled.finally(() => {
    if (pushChains.get(cardId) !== settled) return;
    pushChains.delete(cardId);
    store.setPushing(cardId, false);
  });
  return next;
}

/**
 * Resolve the target state for one card and send it, recording the outcome on the card.
 *
 * @remarks A missing target, or one equal to the card's current or pending state, sends nothing
 * and records nothing; any Linear failure becomes the card notice, and the result carries its copy.
 */
async function pushState(
  cardId: string,
  fromCol: Column,
  toCol: Column,
  chosenStateId: string | undefined,
  deps: OutboundDeps,
): Promise<PushResult> {
  const card = store.getCard(cardId);
  const source = deps.source("linear");
  const teamId = card?.team?.id;
  if (!card || !teamId || !source?.updateState) return { ok: true };
  const teamMap = getOrchestrationConfig()?.sources?.linear?.stateMap?.[teamId];
  if (!chosenStateId && !columnPushes(teamMap, toCol)) return { ok: true };
  const fail = (copy: string) =>
    recordPushFailure(cardId, fromCol, toCol, copy);
  const workflow = await getWorkflow(deps);
  if (!workflow.ok) return fail(workflow.error);
  const states =
    workflow.workflow.teams.find((t) => t.id === teamId)?.states ?? [];
  const targetId = chosenStateId ?? resolveTargetState(teamMap, states, toCol);
  const state = states.find((s) => s.id === targetId);
  if (!state) {
    return chosenStateId
      ? fail("The chosen state is no longer on the card's team.")
      : { ok: true };
  }
  if (state.id === card.linearState?.id || state.id === card.pendingState?.id) {
    return { ok: true };
  }
  try {
    await source.updateState(card.issueId, state.id);
  } catch (err) {
    return fail(outboundErrorCopy(err));
  }
  await store.recordLinearPush(cardId, { ok: true, state, fromCol, toCol });
  deps.poll("linear");
  return { ok: true };
}
