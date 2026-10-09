import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type {
  Card,
  GroupState,
  GroupStateData,
} from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { lastGroupStateOf } from "../domain/group-state.js";

const LOOKBACK = 500;

/**
 * Append one `group_state` event for a group card, unless it repeats the card's last one.
 *
 * @remarks Cards that are not groups write nothing, so the orchestrator card and ticket cards
 * never reach the event stream. A repeat is written again once the card's session went back to
 * `working`. A failure is logged and never thrown, because callers sit in supervisor and ship paths.
 */
export function recordGroupState(
  card: Card | undefined,
  state: GroupState,
  reason: string,
  sessionId?: string | null,
): void {
  if (card?.source !== "group") return;
  try {
    const boardKey = card.boardKey ?? DEFAULT_BOARD_KEY;
    const events = store.listLatestOrchestrationEvents(boardKey, LOOKBACK);
    if (lastGroupStateOf(events, card.id) === state) return;
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
