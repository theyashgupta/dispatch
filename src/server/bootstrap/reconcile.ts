import { store } from "../store/boardStore.js";
import { listSessions } from "../adapters/tmux.js";
import { killDspTtydOrphans } from "../adapters/ttyd.js";

/**
 * Reconcile persisted card state against live tmux reality once at boot: mark cards whose session
 * has vanished as session-lost and sweep orphaned ttyd processes. Tolerant of every tmux error.
 * @remarks IN-01 compares the PERSISTED session name (derived `dsp-<identifier>` only as fallback);
 * IN-02 empty-map baseline recovery (a dead server degrades to an empty live Set, never a crash);
 * IN-03 skips To Do and Done so Restart never promotes a parked card; IN-04 orphaned-ttyd
 * teardown; tolerant swallow-to-default (NEW-10) via `listSessions`.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 */
export async function reconcileSessions(): Promise<void> {
  const live = await listSessions();
  let lost = 0;
  for (const card of store.cardsWithSession()) {
    if (card.column === "todo" || card.column === "done") continue;
    const sessionName = card.tmuxSession ?? "dsp-" + card.identifier;
    if (!live.has(sessionName)) {
      await store.markSessionLost(card.id);
      lost++;
    }
  }
  const killed = await killDspTtydOrphans();
  console.log(
    `[reconcile] session-lost cards: ${lost}; ttyd orphans killed: ${killed}`,
  );
}
