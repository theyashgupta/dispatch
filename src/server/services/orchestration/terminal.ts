import { store } from "../../store/board.store.js";
import { ensureTtyd, killTtyd } from "../../adapters/ttyd.js";
import { hasSession } from "../../adapters/tmux.js";

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
      await store.setTerminalError(cardId, {
        variant: "died",
        stderr: "tmux session no longer exists",
      });
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
