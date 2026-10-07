import { useMemo, useSyncExternalStore } from "react";
import type { BoardSnapshot, Item } from "../../../../shared/types.js";
import { wakeItems } from "../../../../shared/snooze.js";
import { readClock, subscribeClock } from "./wake-clock.js";

/**
 * The board's items as the Inbox lists them: expired snoozes woken, live snoozes hidden.
 *
 * @remarks A once-a-minute tick re-evaluates the wake rule between server frames so a short
 * snooze returns without a reload.
 */
export function useItems(board: BoardSnapshot | null): Item[] {
  const tick = useSyncExternalStore(subscribeClock, readClock);
  return useMemo(() => wakeItems(board?.items ?? [], tick), [board, tick]);
}
