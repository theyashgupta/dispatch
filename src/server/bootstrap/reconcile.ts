import { store } from "../store/board.store.js";
import { listSessions } from "../adapters/tmux.js";
import { adoptAndSweep } from "../adapters/ttyd.js";
import { registerHookToken } from "../services/domain/hook-tokens.js";

/**
 * Reconcile persisted card state against live tmux reality once at boot: mark every SESSION a
 * card owns whose tmux pane has vanished as session-lost, re-register the persisted hook token
 * of every still-live session (sessions deliberately outlive backend restarts; a memory-only
 * token registry would silently 401 their hook POSTs), and adopt-then-sweep ttyd processes
 * (ROBU-01) — re-adopting a live, port-confirmed ttyd instead of unconditionally reaping it, so a
 * restart never drops the user's open terminal iframe. Tolerant of every tmux error.
 * Dead sessions flow through the store's session-lost mutator, which clears AND unregisters the
 * hook token (the store's clearHookToken chokepoint), so no stale registration is possible.
 * Logs counts only, never token values, ports, or PIDs (T-04-04).
 * @remarks IN-01 compares each session's own PERSISTED `tmuxSession`, with no derived-name
 * fallback (Phase 91 removed the `"dsp-" + card.identifier` guess — it was provably unreachable
 * once the iteration source already filters on a non-null `tmuxSession`, and keeping it would let
 * two sibling sessions collide on one derived name at N greater than 1) and no null-guard either:
 * `sessionsWithTmux()` now carries the non-null `tmuxSession` in its RETURN TYPE, so the
 * narrowing costs no dead runtime branch — the same justification that removed the fallback; IN-02 empty-map baseline
 * recovery (a dead server degrades to an empty live Set, never a crash); IN-03 skips To Do and
 * Done ONLY for session-lost marking/Restart-promotion — a card with a live session in either
 * column still falls through to hookToken re-registration and ttyd candidacy below, which a
 * deferred-cleanup Done card now legitimately needs for days; IN-04 orphaned-ttyd teardown, now
 * adopt-then-narrow-sweep rather than reap-everything; tolerant swallow-to-default (NEW-10) via
 * `listSessions`; a session whose adoption attempt fails clears its own stale `ttydPort` and
 * degrades to exactly the pre-ROBU-01 reap+respawn behavior.
 * @remarks (Phase 91, RECON-01) Iterates `store.sessionsWithTmux()` — every session a card owns,
 * not only its active projection — against the SAME single `listSessions` read taken once before
 * the loop. A card with some sessions live and some dead has the dead ones marked lost
 * individually (the store derives the card-level lost flag and repairs the active pointer if it
 * named a dead session), the live ones untouched: a card is never swept because a sibling of the
 * same ticket died. The four counters below now count SESSIONS, not cards — their names are left
 * unchanged so an operator's mental model of the log line does not shift silently.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export async function reconcileSessions(): Promise<void> {
  const live = await listSessions();
  let lost = 0;
  let rebuilt = 0;
  const candidates: {
    session: string;
    port: number;
    cardId: string;
    sessionId: string;
  }[] = [];
  for (const { card, session } of store.sessionsWithTmux()) {
    const sessionName = session.tmuxSession;
    if (!live.has(sessionName)) {
      if (card.column !== "todo" && card.column !== "done") {
        await store.markSessionLost(card.id, session.id);
        lost++;
      }
      continue;
    }
    if (session.hookToken) {
      registerHookToken(session.hookToken, card.id, session.id);
      rebuilt++;
    }
    if (session.ttydPort != null) {
      candidates.push({
        session: sessionName,
        port: session.ttydPort,
        cardId: card.id,
        sessionId: session.id,
      });
    }
  }
  const adopted = await adoptAndSweep(candidates);
  for (const c of candidates) {
    if (!adopted.has(c.session))
      await store.clearStaleTtydPort(c.cardId, c.sessionId);
  }
  console.log(
    `[reconcile] session-lost cards: ${lost}; hook tokens rebuilt: ${rebuilt}; ttyd adopted: ${adopted.size}; ttyd candidates not adopted: ${candidates.length - adopted.size}`,
  );
}
