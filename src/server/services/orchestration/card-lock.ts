import { boardRepository as store } from "../../store/board-repository.js";

const inFlight = new Set<string>();

/**
 * Run `fn` under the card lock, or return `busy` while a start, relaunch, move or pause holds it
 * or the card is paused.
 *
 * @remarks Run Claude and the account move share it because two overlapping `send-keys -l`
 * interleave on one shell line, and a paused pane must never receive typed input. Only pause and
 * unpause pass `allowPaused`.
 */
export async function withCardLock<T>(
  cardId: string,
  fn: () => Promise<T>,
  opts: { allowPaused?: boolean } = {},
): Promise<T | "busy"> {
  if (inFlight.has(cardId) || store.isStarting(cardId)) return "busy";
  if (!opts.allowPaused && store.getCard(cardId)?.paused) return "busy";
  inFlight.add(cardId);
  try {
    return await fn();
  } finally {
    inFlight.delete(cardId);
  }
}
