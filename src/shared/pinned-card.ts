import { membersOf } from "./group-members.js";
import type { Card as CardModel } from "./types.js";

export type PinnedCard = {
  card: CardModel;
  kind: "stub" | "hydrated";
  members: CardModel[];
};

/**
 * Returns the pinned card to act on when a live-window lookup misses, or `null` for a stub.
 *
 * @remarks
 * A stub's non-identity fields are filler (`search-stub.ts`), so only a hydrated pinned card is
 * actionable. Every click-time action derivation shares this guard so none can
 * re-collapse the stub/hydrated distinction.
 */
export function actionablePinnedCard(
  id: string | null | undefined,
  pinned: PinnedCard | null,
): CardModel | null {
  return pinned != null && pinned.kind === "hydrated" && pinned.card.id === id
    ? pinned.card
    : null;
}

/**
 * Decides whether a member row is actionable in the pinned-fallback case.
 *
 * @remarks
 * Same guard as `actionablePinnedCard`, returning a boolean: a stub's members are filler and must
 * never be actionable. Callers OR this with their own in-window test. `MemberRow`'s `actionable`
 * prop is required with no default so a new call site is a compile error.
 */
export function actionablePinnedMembers(
  id: string | null | undefined,
  pinned: PinnedCard | null,
): boolean {
  return pinned != null && pinned.kind === "hydrated" && pinned.card.id === id;
}

/** The live board card for `id` as a hydrated pin with its members, or null when it is not in the window. */
export function pinFromBoard(
  id: string | null,
  cards: CardModel[],
): PinnedCard | null {
  const live = id == null ? undefined : cards.find((card) => card.id === id);
  return live == null
    ? null
    : { card: live, kind: "hydrated", members: membersOf(live, cards) };
}

/** The selected card: the live board card first, else the pinned card when it is the selection. */
export function selectedCardOf(
  cards: readonly CardModel[] | undefined,
  selectedId: string | null,
  pinned: PinnedCard | null,
): CardModel | null {
  return (
    cards?.find((card) => card.id === selectedId) ??
    (pinned?.card.id === selectedId ? pinned.card : null)
  );
}
