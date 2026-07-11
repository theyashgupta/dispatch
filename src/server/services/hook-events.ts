import { markerKey, parseLastMarker } from "../adapters/markers/parse.js";
import { store } from "../store/board.store.js";
import { getHooksRuntime } from "./config-holder.js";

/**
 * Per-card epoch ms of the last hook-driven activity stamp — the 2s throttle state. Channel
 * policy lives HERE, never in the store (setOutputChanged's JSDoc forbids coalescing there).
 * In-memory only: a backend restart just allows one early stamp, which is harmless.
 */
const lastActivityStampMs = new Map<string, number>();

/**
 * Minimum ms between hook-driven activity stamps per card. Matches the pane watcher's 2000ms
 * tick, so hook-path dot latency is never worse than the pane path's while a parallel tool-call
 * burst can no longer enqueue several board.json writes + SSE frames per second.
 */
const ACTIVITY_THROTTLE_MS = 2000;

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
async function applyStopEvent(
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
async function applyPromptSubmit(cardId: string): Promise<void> {
  await store.flipBack(cardId);
}

/**
 * The single channel-policy entry point for every authenticated hook event, owning in order:
 * the pane-mode no-op guard (a straggler session injected before a config flip to `pane` must
 * mutate NOTHING — no latch, no stamp, no marker/flip; the route still authenticates), the
 * write-once hook-routed latch (any authenticated event proves the session's hook capability;
 * the read-before-enqueue guard prevents per-event write churn and its benign race worst-cases
 * at one duplicate write of the same semantic value), the throttled activity stamp on
 * PostToolUse/Stop only (the user's own typing is not agent output, so UserPromptSubmit never
 * stamps), and the existing Stop/UserPromptSubmit board mapping. PostToolUse binds ONLY to
 * `hook_event_name` — `tool_*` payload keys are unstable across CLI releases and never read.
 * Unknown events end after the latch/stamp as no-ops.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export async function applyHookEvent(
  cardId: string,
  body:
    { hook_event_name?: unknown; last_assistant_message?: unknown } | undefined,
): Promise<void> {
  if (getHooksRuntime()?.statusChannel === "pane") return;

  if (store.getCard(cardId)?.hookRoutedAt == null) {
    await store.markHookRouted(cardId, new Date().toISOString());
  }

  const event = body?.hook_event_name;
  if (event === "PostToolUse" || event === "Stop") {
    const now = Date.now();
    const last = lastActivityStampMs.get(cardId);
    if (last === undefined || now - last >= ACTIVITY_THROTTLE_MS) {
      lastActivityStampMs.set(cardId, now);
      await store.setOutputChanged(cardId, new Date().toISOString());
    }
  }

  if (event === "Stop" && typeof body?.last_assistant_message === "string") {
    await applyStopEvent(cardId, body.last_assistant_message);
  } else if (event === "UserPromptSubmit") {
    await applyPromptSubmit(cardId);
  }
}
