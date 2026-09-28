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
import { store } from "../../store/board.store.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { outboundErrorCopy } from "./outbound-error.js";

export type OutboundOutcome =
  { ok: true } | { ok: false; status: 404 | 409 | 502; error: string };

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
export function setLinearState(
  cardId: string,
  stateId: string,
  deps: OutboundDeps = LIVE,
): Promise<void> {
  const column = store.getCard(cardId)?.column;
  if (!column) return Promise.resolve();
  return chainPush(cardId, () =>
    pushState(cardId, column, column, stateId, deps),
  );
}

/** Run `push` after every earlier push for the same card has settled. */
function chainPush(cardId: string, push: () => Promise<void>): Promise<void> {
  const next = (pushChains.get(cardId) ?? Promise.resolve())
    .then(push)
    .catch((err: unknown) => {
      console.warn(
        `[linear-push] push for card ${cardId} failed:`,
        (err as Error).message,
      );
    });
  pushChains.set(cardId, next);
  store.setPushing(cardId, true);
  void next.finally(() => {
    if (pushChains.get(cardId) !== next) return;
    pushChains.delete(cardId);
    store.setPushing(cardId, false);
  });
  return next;
}

/**
 * Resolve the target state for one card and send it, recording the outcome on the card.
 *
 * @remarks A missing target, or one equal to the card's current or pending state, sends nothing
 * and records nothing; any Linear failure becomes the card notice and never throws.
 */
async function pushState(
  cardId: string,
  fromCol: Column,
  toCol: Column,
  chosenStateId: string | undefined,
  deps: OutboundDeps,
): Promise<void> {
  const card = store.getCard(cardId);
  const source = deps.source("linear");
  const teamId = card?.team?.id;
  if (!card || !teamId || !source?.updateState) return;
  const teamMap = getOrchestrationConfig()?.sources?.linear?.stateMap?.[teamId];
  if (!chosenStateId && !columnPushes(teamMap, toCol)) return;
  const fail = (copy: string) =>
    store.recordLinearPush(cardId, {
      ok: false,
      copy: `Linear state not updated. ${copy}`,
      fromCol,
      toCol,
    });
  const workflow = await getWorkflow(deps);
  if (!workflow.ok) {
    await fail(workflow.error);
    return;
  }
  const states =
    workflow.workflow.teams.find((t) => t.id === teamId)?.states ?? [];
  const targetId = chosenStateId ?? resolveTargetState(teamMap, states, toCol);
  const state = states.find((s) => s.id === targetId);
  if (
    !state ||
    state.id === card.linearState?.id ||
    state.id === card.pendingState?.id
  ) {
    return;
  }
  try {
    await source.updateState(card.issueId, state.id);
  } catch (err) {
    await fail(outboundErrorCopy(err));
    return;
  }
  await store.recordLinearPush(cardId, { ok: true, state, fromCol, toCol });
  deps.poll("linear");
}
