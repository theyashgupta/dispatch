import { existsSync } from "node:fs";
import { store } from "../../store/board.store.js";
import { ensureTtyd, killTtyd } from "../../adapters/ttyd.js";
import { hasSession } from "../../adapters/tmux.js";
import { TTYD_INDEX_PATH } from "../infra/paths.js";

/**
 * Ensure a ttyd terminal for a card's `session` and record its port — the SINGLE TERM-01
 * implementation shared by the /terminal route and the resume saga (a second copy would let the
 * security-sensitive stale-port suppression drift). ensureTtyd is single-flight, so a duplicate
 * concurrent call resolves the same spawn and simply re-records the port (idempotent). The port
 * is recorded only while the card still names `session` (the in-queue setTtydPortIfSession
 * conditional), so a concurrent session-lost write reliably suppresses a stale port. `cardId` is
 * threaded into `ensureTtyd` so ttyd spawns with the `-b /sessions/<cardId>/terminal` base-path
 * the reverse proxy routes to (PROXY-01) — already in scope here, no new lookup. SECURITY: no
 * ticket text, port, or secret is echoed in any response or log.
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export async function ensureTerminal(
  cardId: string,
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
    const indexPath = existsSync(TTYD_INDEX_PATH) ? TTYD_INDEX_PATH : null;
    const port = await ensureTtyd(session, cardId, indexPath);
    const recorded = await store.setTtydPortIfSession(cardId, session, port);
    if (!recorded) killTtyd(session);
  } catch (err) {
    await store.setTerminalError(cardId, {
      variant: "spawn",
      stderr: err instanceof Error ? err.message : String(err),
    });
  }
}
