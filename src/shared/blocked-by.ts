import { isHiddenCard } from "./hidden-card.js";
import type { Card } from "./types.js";

/**
 * True when a blocker card is in Done, or has at least one PR and every PR merged.
 *
 * @remarks
 * A missing card counts as not done. The server start gate and the web chip share this rule.
 */
export function isBlockerDone(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.column === "done") return true;
  const prs = card.prs ?? [];
  return prs.length > 0 && prs.every((pr) => pr.state === "merged");
}

/** The ids in `card.blockedBy` whose blocker is not done, in stored order. */
export function openBlockers(
  card: Pick<Card, "blockedBy">,
  isDone: (id: string) => boolean,
): string[] {
  return (card.blockedBy ?? []).filter((id) => !isDone(id));
}

/** The identifier of each id's card, or the id itself when the card is missing. */
export function blockerIdentifiers(
  ids: readonly string[],
  getCard: (id: string) => Card | undefined,
): string[] {
  return ids.map((id) => getCard(id)?.identifier ?? id);
}

/**
 * The chip for the open blockers of a card, or null when none is open or the card is not in To Do
 * or Inbox.
 *
 * @remarks The label names the first open blocker plus ` +N` for the rest. The title names all.
 * Past To Do a blocker no longer matters, and a Done blocker pruned from the board window would
 * read as open.
 */
export function blockerChip(
  card: Card,
  byId: ReadonlyMap<string, Card>,
): { label: string; title: string } | null {
  if (card.column !== "todo" && card.column !== "inbox") return null;
  const open = openBlockers(card, (id) => isBlockerDone(byId.get(id)));
  const names = blockerIdentifiers(open, (id) => byId.get(id));
  const first = names[0];
  if (first === undefined) return null;
  return {
    label: names.length > 1 ? `${first} +${names.length - 1}` : first,
    title: `Blocked by ${names.join(", ")}`,
  };
}

/** True for a card that can take blockers: not a group, not a group member, not an orchestrator card. */
export function canBeBlocked(card: Pick<Card, "source" | "groupId">): boolean {
  return card.source !== "group" && card.groupId == null && !isHiddenCard(card);
}
