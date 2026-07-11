import { markerKey, parseLastMarker } from "../adapters/markers/parse.js";
import { store } from "../store/board.store.js";

/**
 * Map a Stop hook event onto the board: parse the final assistant message for its last
 * status marker and apply it through the single-writer store. A marker-free message is a
 * silent no-op — every turn ends with Stop and most carry no marker.
 *
 * @remarks The dedup key written here MUST be `markerKey(parseLastMarker(message))` verbatim
 * (the exact kind-space-reason format from parse.ts) so the untouched pane watcher's
 * sameMarkerKey prefix dedup sees a hook-applied marker as already consumed and never
 * re-fires it. The hook channel is edge-triggered, so no dedup heuristics live here; the
 * level-triggered watcher carries that burden. Reusing parseLastMarker also inherits the
 * kickoff-placeholder guard and last-match-wins over multi-line messages.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export async function applyStopEvent(
  cardId: string,
  lastAssistantMessage: string,
): Promise<void> {
  const marker = parseLastMarker(lastAssistantMessage);
  if (!marker) return;
  const column = marker.kind === "NEEDS_INPUT" ? "needs_input" : "agent_done";
  const reason = marker.reason === "" ? undefined : marker.reason;
  await store.applyMarker(cardId, column, reason, markerKey(marker));
}

/**
 * Map a UserPromptSubmit hook event onto flipBack: the user replied, definitionally. Binds
 * ONLY to the event name plus token-derived card identity — payload message-text keys are
 * unstable across CLI releases and are never read. flipBack re-checks the column inside the
 * store queue, so the kickoff paste's own UserPromptSubmit no-ops mid-saga.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export async function applyPromptSubmit(cardId: string): Promise<void> {
  await store.flipBack(cardId);
}
