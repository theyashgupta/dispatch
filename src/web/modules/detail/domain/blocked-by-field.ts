import { isBlockerDone } from "../../../../shared/blocked-by.js";
import { isHiddenCard } from "../../../../shared/hidden-card.js";
import type { Card } from "../../../../shared/types.js";

export interface BlockerOption {
  id: string;
  identifier: string;
  title: string;
}

export interface BlockerRow extends BlockerOption {
  open: boolean;
}

/** One row per stored blocker; a blocker missing from the board shows as open. */
export function blockerRows(card: Card, cards: readonly Card[]): BlockerRow[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return (card.blockedBy ?? []).map((id) => {
    const blocker = byId.get(id);
    return {
      id,
      identifier: blocker?.identifier ?? id,
      title: blocker?.title ?? "Not on this board",
      open: !isBlockerDone(blocker),
    };
  });
}

/** Cards that can still be added as a blocker of `card`. */
export function blockerOptions(
  card: Card,
  cards: readonly Card[],
): BlockerOption[] {
  const taken = new Set(card.blockedBy ?? []);
  return cards
    .filter(
      (c) =>
        c.id !== card.id &&
        !taken.has(c.id) &&
        c.groupId == null &&
        !isHiddenCard(c),
    )
    .map(({ id, identifier, title }) => ({ id, identifier, title }));
}

/** User-facing text for a refused blocker update; status 0 means the server never answered. */
export function blockedByErrorCopy(failure: {
  status: number;
  error: string | null;
  reason: string | null;
}): string {
  if (failure.status === 0) return "Could not reach the server";
  const code = failure.error ?? `Request failed (${failure.status})`;
  return failure.reason != null ? `${code}: ${failure.reason}` : code;
}
