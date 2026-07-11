import fs from "node:fs";
import type { BoardSnapshot } from "../../shared/types.js";

/** Hardcoded rolling backup slot count (`.bak.1` .. `.bak.5`); no config surface (BAK-01). */
export const BACKUP_SLOTS = 5;

const HOUR_MS = 3_600_000;

let rotationFailureLogged = false;

/**
 * Rotate the board.json backup chain at most once per hour, best-effort. NEVER throws: a
 * rotation failure is logged once per process boot and swallowed so it can never block or
 * delay the primary write (the caller runs it before writeFileAtomic inside the single-writer
 * queue). The hour clock is the mtime of `.bak.1` — restart-durable, zero new persisted state;
 * a missing `.bak.1` bootstraps the chain. `.bak.1` is a byte copy of the existing on-disk
 * board.json (the last-known-good snapshot), never a re-serialization of the new state. Logs
 * only paths + the error message, never backup contents (board.json carries hook-token secrets).
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export async function rotateBackups(boardPath: string): Promise<void> {
  const bak = (n: number): string => `${boardPath}.bak.${n}`;
  try {
    let elapsed = true;
    try {
      const { mtimeMs } = await fs.promises.stat(bak(1));
      elapsed = Date.now() - mtimeMs >= HOUR_MS;
    } catch {}
    if (!elapsed) return;
    for (let i = BACKUP_SLOTS - 1; i >= 1; i--) {
      try {
        await fs.promises.rename(bak(i), bak(i + 1));
      } catch {}
    }
    await fs.promises.copyFile(boardPath, bak(1));
  } catch (err) {
    if (!rotationFailureLogged) {
      rotationFailureLogged = true;
      console.error(
        "[store] backup rotation failed (primary write unaffected):",
        (err as Error).message,
      );
    }
  }
}

/**
 * Walk the backup chain `.bak.1` -> `.bak.5` most-recent-first and return the first snapshot
 * that parses (same lenient JSON.parse validity as load()). On success emits a LOUD warning
 * naming the exact file used, so a recovery is never silent; on total failure returns null and
 * the caller starts an empty board (also with a warning). Best-effort per slot: an unreadable or
 * unparseable slot is skipped, never surfaced. Logs only the recovered file path, never contents.
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export async function recoverFromBackups(
  boardPath: string,
): Promise<Partial<BoardSnapshot> | null> {
  const bak = (n: number): string => `${boardPath}.bak.${n}`;
  for (let i = 1; i <= BACKUP_SLOTS; i++) {
    try {
      const raw = await fs.promises.readFile(bak(i), "utf8");
      const parsed = JSON.parse(raw) as Partial<BoardSnapshot>;
      console.warn(
        `[store] recovered board state from ${bak(i)} after board.json was unreadable/unparseable.`,
      );
      return parsed;
    } catch {}
  }
  return null;
}
