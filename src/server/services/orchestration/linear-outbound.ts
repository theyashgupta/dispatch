import { pollNow } from "../../adapters/poller.js";
import { sourceCommenter } from "../../adapters/source-gateway.js";
import { store } from "../../store/board.store.js";
import { outboundErrorCopy } from "./outbound-error.js";

export type CommentOutcome =
  { ok: true } | { ok: false; status: 404 | 409 | 502; error: string };

export interface OutboundDeps {
  commenter: typeof sourceCommenter;
  poll: (sourceId: string) => boolean;
}

const LIVE: OutboundDeps = { commenter: sourceCommenter, poll: pollNow };

/**
 * Post a comment on a Linear card and refresh the board through a poll.
 *
 * @remarks A failure stores the fixed copy on the card as `linearError` and skips the poll; the
 * next success clears it.
 */
export async function postComment(
  cardId: string,
  body: string,
  deps: OutboundDeps = LIVE,
): Promise<CommentOutcome> {
  const card = store.getCard(cardId);
  if (!card) {
    return { ok: false, status: 404, error: `unknown card id: ${cardId}` };
  }
  const add =
    (card.source ?? "linear") === "linear"
      ? deps.commenter("linear")
      : undefined;
  if (!add) return { ok: false, status: 409, error: "source cannot comment" };
  try {
    await add(card.issueId, body);
  } catch (err) {
    const copy = outboundErrorCopy(err);
    await store.setLinearError(cardId, copy);
    return { ok: false, status: 502, error: copy };
  }
  await store.setLinearError(cardId, null);
  deps.poll("linear");
  return { ok: true };
}
