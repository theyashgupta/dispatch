import { store } from "../store/board.store.js";
import { listSessions } from "../adapters/tmux.js";
import { killDspTtydOrphans } from "../adapters/ttyd.js";
import { registerHookToken } from "../services/domain/hook-tokens.js";

/**
 * Reconcile persisted card state against live tmux reality once at boot: mark cards whose session
 * has vanished as session-lost, re-register the persisted hook token of every still-live session
 * (sessions deliberately outlive backend restarts; a memory-only token registry would silently
 * 401 their hook POSTs), and sweep orphaned ttyd processes. Tolerant of every tmux error.
 * Dead-session cards flow through markSessionLost, which clears AND unregisters hookToken
 * (the store's clearHookToken chokepoint), so no stale registration is possible. Logs a rebuilt-token count only, never token values.
 * @remarks IN-01 compares the PERSISTED session name (derived `dsp-<identifier>` only as fallback);
 * IN-02 empty-map baseline recovery (a dead server degrades to an empty live Set, never a crash);
 * IN-03 skips To Do and Done so Restart never promotes a parked card; IN-04 orphaned-ttyd
 * teardown; tolerant swallow-to-default (NEW-10) via `listSessions`.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export async function reconcileSessions(): Promise<void> {
  const live = await listSessions();
  let lost = 0;
  let rebuilt = 0;
  for (const card of store.cardsWithSession()) {
    if (card.column === "todo" || card.column === "done") continue;
    const sessionName = card.tmuxSession ?? "dsp-" + card.identifier;
    if (!live.has(sessionName)) {
      await store.markSessionLost(card.id);
      lost++;
    } else if (card.hookToken) {
      registerHookToken(card.hookToken, card.id);
      rebuilt++;
    }
  }
  const killed = await killDspTtydOrphans();
  console.log(
    `[reconcile] session-lost cards: ${lost}; hook tokens rebuilt: ${rebuilt}; ttyd orphans killed: ${killed}`,
  );
}
