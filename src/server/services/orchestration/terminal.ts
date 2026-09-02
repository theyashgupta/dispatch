import { store } from "../../store/board.store.js";
import { ensureTtyd, killTtyd } from "../../adapters/ttyd.js";
import { captureHistory, hasSession } from "../../adapters/tmux.js";

/**
 * Ensure a ttyd terminal for a card's `session` and record its port — the SINGLE TERM-01
 * implementation shared by the /terminal route and the resume saga (a second copy would let the
 * security-sensitive stale-port suppression drift). ensureTtyd is single-flight, so a duplicate
 * concurrent call resolves the same spawn and simply re-records the port (idempotent). The port
 * is recorded only while the card still names `session` (the in-queue setTtydPortIfSession
 * conditional), so a concurrent session-lost write reliably suppresses a stale port. `cardId`
 * keeps its two genuinely card-scoped uses below (`setTerminalError`, `setTtydPortIfSession`); the
 * NEW `sessionId` threads separately, only into `ensureTtyd`, so ttyd spawns with the
 * `-b /sessions/<sessionId>/terminal` base-path the session-keyed reverse proxy routes to
 * (PROXY-01) — this is not the same id as `cardId`, and the two must never be conflated.
 * A vanished tmux pane is recorded as session-lost (skipped while a cleanup is tearing it down),
 * never as a `died` terminal error: the error variant only offers Reconnect, which can never
 * bring back a pane that no longer exists, while session-lost offers Resume, which can.
 * SECURITY: no ticket text, port, or secret is echoed in any response or log.
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export async function ensureTerminal(
  cardId: string,
  sessionId: string,
  session: string,
): Promise<void> {
  try {
    if (!(await hasSession(`=${session}`))) {
      if (!store.isCleaningUp(cardId)) {
        await store.markSessionLost(cardId, sessionId);
      }
      return;
    }
    const port = await ensureTtyd(session, sessionId);
    const recorded = await store.setTtydPortIfSession(cardId, session, port);
    if (!recorded) killTtyd(session);
  } catch (err) {
    await store.setTerminalError(cardId, {
      variant: "spawn",
      stderr: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * The pane HISTORY (rows above the visible screen) for a session id, as colour-preserving ANSI
 * text, or null when no live session matches the id.
 *
 * @remarks TERM-05: the scrollback-seed transport. Lives here because routes may not call the
 * subprocess adapters directly, and the session-id -> tmux-name lookup is the same
 * `sessionsWithTmux()` scan the proxy's port resolution uses.
 */
export async function sessionScrollback(
  sessionId: string,
  limit: number,
): Promise<string | null> {
  const pair = store
    .sessionsWithTmux()
    .find((entry) => entry.session.id === sessionId);
  if (!pair) return null;
  return captureHistory(pair.session.tmuxSession, limit);
}
