import { useEffect, useMemo, useState } from "react";
import type { BoardSnapshot, Item } from "../../shared/types.js";
import { wakeItems } from "../lib/snooze.js";

const ITEM_WAKE_TICK_MS = 60_000;

/**
 * The board's items as the Inbox lists them: expired snoozes woken, live snoozes hidden.
 *
 * @remarks A once-a-minute tick re-evaluates the wake rule between server frames so a short
 * snooze returns without a reload; the board itself keeps flowing from App.
 */
export function useItems(board: BoardSnapshot | null): Item[] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ITEM_WAKE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return useMemo(() => wakeItems(board?.items ?? [], now), [board, now]);
}
