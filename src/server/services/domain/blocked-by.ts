import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { canBeBlocked, openBlockers } from "../../../shared/blocked-by.js";
import { isHiddenCard } from "../../../shared/hidden-card.js";
import type { BoardKey, Card } from "../../../shared/types.js";

export type BlockedByCode =
  "invalid-blocked-card" | "invalid-blocker" | "blocked-by-cycle";

export type BlockedByResult =
  | { ok: true; ids: string[] }
  | { ok: false; code: BlockedByCode; reason: string };

type Blocked = Pick<Card, "id" | "identifier" | "source" | "groupId">;

const refuse = (code: BlockedByCode, reason: string): BlockedByResult => ({
  ok: false,
  code,
  reason,
});

/** The refusal for a card that cannot be blocked, or null when it can. */
function blockedCardError(card: Blocked): BlockedByResult | null {
  if (card.source === "group") {
    return refuse("invalid-blocked-card", "a group card cannot be blocked");
  }
  if (card.groupId != null) {
    return refuse("invalid-blocked-card", "a group member cannot be blocked");
  }
  if (isHiddenCard(card)) {
    return refuse("invalid-blocked-card", "this card cannot be blocked");
  }
  return null;
}

/** The refusal for a card that cannot block, or null when it can. */
function blockerError(
  blocker: Card | undefined,
  boardKey: BoardKey,
  id: string,
): BlockedByResult | null {
  if (blocker === undefined) {
    return refuse("invalid-blocker", `unknown blocker: ${id}`);
  }
  if ((blocker.boardKey ?? DEFAULT_BOARD_KEY) !== boardKey) {
    return refuse("invalid-blocker", `blocker ${id} is on another board`);
  }
  if (blocker.groupId != null || isHiddenCard(blocker)) {
    return refuse("invalid-blocker", `blocker ${id} cannot block a card`);
  }
  return null;
}

/**
 * The identifier chain that leads from the blocked card back to itself, or null when none does.
 *
 * @remarks The proposed list stands in for the stored list of the blocked card only. The visited
 * set stops the walk on a cycle that does not include the blocked card.
 */
function cycleChain(
  card: Blocked,
  ids: string[],
  getCard: (id: string) => Card | undefined,
): string[] | null {
  const visited = new Set<string>();
  const walk = (id: string, path: string[]): string[] | null => {
    if (id === card.id) return [...path, card.identifier];
    if (visited.has(id)) return null;
    visited.add(id);
    const next = getCard(id);
    if (next === undefined) return null;
    for (const onward of next.blockedBy ?? []) {
      const found = walk(onward, [...path, next.identifier]);
      if (found !== null) return found;
    }
    return null;
  };
  for (const id of ids) {
    const found = walk(id, [card.identifier]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Check a proposed blocker list and return it without duplicates, or the first refusal.
 *
 * @remarks Pass `card` for an existing card to also refuse a blocked card that cannot wait and a
 * cycle. A card that does not exist yet cannot be in a cycle, so create passes no `card`.
 */
export function checkBlockers(
  boardKey: BoardKey,
  ids: string[],
  getCard: (id: string) => Card | undefined,
  card?: Blocked,
): BlockedByResult {
  if (card !== undefined) {
    const refused = blockedCardError(card);
    if (refused !== null) return refused;
  }
  const unique = [...new Set(ids)];
  for (const id of unique) {
    const refused = blockerError(getCard(id), boardKey, id);
    if (refused !== null) return refused;
  }
  if (card !== undefined) {
    const chain = cycleChain(card, unique, getCard);
    if (chain !== null) return refuse("blocked-by-cycle", chain.join(" -> "));
  }
  return { ok: true, ids: unique };
}

type Blockable = Pick<Card, "blockedBy">;

/**
 * True for a never-started To Do card with blockers that are all done and nothing that holds it back.
 *
 * @remarks A group card, a group member, a hidden card and a paused card never qualify. A card that
 * failed to start or already ran a session is left to the user; a session record that only holds a
 * preset workspace is not a run. Whether a session is running now needs the store, so the caller
 * checks that.
 */
export function isReadyBlocked(
  card: Blockable &
    Pick<
      Card,
      "column" | "source" | "groupId" | "paused" | "startError" | "sessions"
    >,
  isDone: (id: string) => boolean,
): boolean {
  return (
    (card.blockedBy?.length ?? 0) > 0 &&
    openBlockers(card, isDone).length === 0 &&
    card.column === "todo" &&
    canBeBlocked(card) &&
    !card.paused &&
    !card.startError &&
    !card.sessions?.some(
      (s) => s.tmuxSession != null || s.claudeSessionId != null,
    )
  );
}
