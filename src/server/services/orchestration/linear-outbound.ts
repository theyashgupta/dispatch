import type { LinearWorkflow } from "../../../shared/types.js";
import { pollNow } from "../../adapters/poller.js";
import {
  enabledSource,
  type TicketSource,
} from "../../adapters/source-gateway.js";
import { store } from "../../store/board.store.js";
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
