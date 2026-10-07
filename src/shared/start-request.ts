import type { Card } from "./types.js";

export interface StartRequest {
  cardId: string;
  newSession?: boolean;
  extraDirection?: string;
}

/** The board card a start request names, for the start rule to check. */
export function startTarget(
  req: string | StartRequest,
  cards: readonly Card[] | undefined,
): Card | undefined {
  const id = typeof req === "string" ? req : req.cardId;
  return cards?.find((card) => card.id === id);
}
