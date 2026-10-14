import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type {
  Card,
  GroupState,
  GroupStateData,
} from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { isLoopCard } from "../../../shared/running-group.js";
import { lastGroupStateOf } from "../domain/group-state.js";

const LOOKBACK = 500;

/**
 * Append one `group_state` event for a loop card, unless it repeats the card's last one.
 *
 * @remarks A repeat is written again once the card's session went back to `working`, and a `start_failed` state is never a repeat. A failure is logged and never thrown, because callers sit in supervisor and ship paths.
 */
export function recordGroupState(
  card: Card | undefined,
  state: GroupState,
  reason: string,
  sessionId?: string | null,
): void {
  if (card === undefined || !isLoopCard(card)) return;
  try {
    const boardKey = card.boardKey ?? DEFAULT_BOARD_KEY;
    const events = store.listLatestOrchestrationEvents(boardKey, LOOKBACK);
    if (state !== "start_failed" && lastGroupStateOf(events, card.id) === state)
      return;
    const data: GroupStateData = { state, reason };
    store.appendOrchestrationEvent({
      boardKey,
      cardId: card.id,
      sessionId:
        sessionId === undefined ? (card.activeSessionId ?? null) : sessionId,
      kind: "group_state",
      data,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(
      `[group-state] could not record ${state}: ${(err as Error).message}`,
    );
  }
}
