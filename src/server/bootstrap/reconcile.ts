import { store } from "../store/board.store.js";
import { listSessions } from "../adapters/tmux.js";
import { adoptAndSweep } from "../adapters/ttyd.js";
import { registerHookToken } from "../services/domain/hook-tokens.js";

/**
 * Reconcile persisted card state against live tmux reality once at boot: mark cards whose session
 * has vanished as session-lost, re-register the persisted hook token of every still-live session
 * (sessions deliberately outlive backend restarts; a memory-only token registry would silently
 * 401 their hook POSTs), and adopt-then-sweep ttyd processes (ROBU-01) — re-adopting a live,
 * port-confirmed ttyd instead of unconditionally reaping it, so a restart never drops the user's
 * open terminal iframe. Tolerant of every tmux error.
 * Dead-session cards flow through markSessionLost, which clears AND unregisters hookToken
 * (the store's clearHookToken chokepoint), so no stale registration is possible. Logs counts
 * only, never token values, ports, or PIDs (T-04-04).
 * @remarks IN-01 compares the PERSISTED session name (derived `dsp-<identifier>` only as fallback);
 * IN-02 empty-map baseline recovery (a dead server degrades to an empty live Set, never a crash);
 * IN-03 skips To Do and Done so Restart never promotes a parked card; IN-04 orphaned-ttyd
 * teardown, now adopt-then-narrow-sweep rather than reap-everything; tolerant swallow-to-default
 * (NEW-10) via `listSessions`; a card whose adoption attempt fails clears its stale `ttydPort` and
 * degrades to exactly the pre-ROBU-01 reap+respawn behavior.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export async function reconcileSessions(): Promise<void> {
  const live = await listSessions();
  let lost = 0;
  let rebuilt = 0;
  const candidates: { session: string; port: number; cardId: string }[] = [];
  for (const card of store.cardsWithSession()) {
    if (card.column === "todo" || card.column === "done") continue;
    const sessionName = card.tmuxSession ?? "dsp-" + card.identifier;
    if (!live.has(sessionName)) {
      await store.markSessionLost(card.id);
      lost++;
      continue;
    }
    if (card.hookToken) {
      registerHookToken(card.hookToken, card.id);
      rebuilt++;
    }
    if (card.ttydPort != null) {
      candidates.push({
        session: sessionName,
        port: card.ttydPort,
        cardId: card.id,
      });
    }
  }
  const adopted = await adoptAndSweep(candidates);
  for (const c of candidates) {
    if (!adopted.has(c.session)) await store.clearStaleTtydPort(c.cardId);
  }
  console.log(
    `[reconcile] session-lost cards: ${lost}; hook tokens rebuilt: ${rebuilt}; ttyd adopted: ${adopted.size}; ttyd candidates not adopted: ${candidates.length - adopted.size}`,
  );
}
