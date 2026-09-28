import { useEffect, useState } from "react";
import type { LinearComment } from "../../shared/types.js";
import { getCardComments } from "../lib/api.js";

/**
 * Load a Linear card's stored comments, refetching when the card's comment signature changes.
 *
 * @remarks `lastCommentId` is part of the key because the list is capped at five, so a new comment
 * on a full card leaves the count unchanged. Another card's list is never returned while the new
 * card's fetch is in flight.
 */
export function useCardComments(
  cardId: string,
  commentCount: number | undefined,
  lastCommentId: string | undefined,
): LinearComment[] {
  const [loaded, setLoaded] = useState<{
    cardId: string;
    comments: LinearComment[];
  }>({ cardId, comments: [] });
  useEffect(() => {
    let live = true;
    getCardComments(cardId)
      .then((next) => {
        if (live) setLoaded({ cardId, comments: next });
      })
      .catch((err: unknown) => {
        console.error("useCardComments: fetch failed", err);
      });
    return () => {
      live = false;
    };
  }, [cardId, commentCount, lastCommentId]);
  return loaded.cardId === cardId ? loaded.comments : [];
}
