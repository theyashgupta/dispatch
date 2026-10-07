import type { BoardKey, Card } from "./types.js";
import type { CardSearchResult } from "./search.js";

/**
 * Widens a search hit into a placeholder `Card` so detail opens at once (SCALE-03).
 *
 * @remarks
 * Every non-identity field is filler, so the stub is always paired with `hydrating: true` on
 * `DetailPanel`, which keeps those values out of the DOM. This is the only construction site for a
 * synthetic card.
 */
export function stubToCard(stub: CardSearchResult, boardKey: BoardKey): Card {
  return {
    id: stub.id,
    boardKey,
    identifier: stub.identifier,
    title: stub.title,
    column: stub.column,
    issueId: "",
    description: null,
    priority: 0,
    updatedAt: new Date(0).toISOString(),
  };
}
