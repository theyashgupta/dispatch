import fs from "node:fs";
import type { BoardSnapshot } from "../../shared/types.js";

/** Hardcoded rolling backup slot count (`.bak.1` .. `.bak.5`); no config surface (BAK-01). */
export const BACKUP_SLOTS = 5;

const HOUR_MS = 3_600_000;

let rotationFailureLogged = false;

/**
 * Rotate the board.json backup chain at most once per hour, best-effort. NEVER throws a
 * rotation error into the caller: any failure is logged once per process boot and swallowed,
 * so it can never fail the primary write (the caller awaits it before writeFileAtomic inside
 * the single-writer queue; on the hourly tick it costs a bounded handful of local fs ops).
 * The hour clock is the mtime of `.bak.1` — restart-durable, zero new persisted state; a
 * missing `.bak.1` bootstraps the chain. The new `.bak.1` is a byte copy of the existing
 * on-disk board.json (the last-known-good snapshot), never a re-serialization of the new state.
 *
 * @remarks
 * The snapshot is copied to a sibling `.bak.tmp` BEFORE any slot is shifted, and only an
 * intact temp copy is renamed into `.bak.1` after the shift. This ordering is what makes the
 * chain crash-safe: if the copy fails (disk full, unwritable path), no slot has moved yet, so a
 * persistently failing copy can never cascade-shift and drain the whole chain (which would
 * silently destroy every recovery point). A first-run/missing board.json (ENOENT on the source
 * copy) is a no-op, not a failure — there is nothing to back up until the first write lands.
 * Logs only paths + the error message, never backup contents (board.json carries hook-token secrets).
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export async function rotateBackups(boardPath: string): Promise<void> {
  const bak = (n: number): string => `${boardPath}.bak.${n}`;
  const tmp = `${boardPath}.bak.tmp`;
  try {
    let elapsed = true;
    try {
      const { mtimeMs } = await fs.promises.stat(bak(1));
      elapsed = Date.now() - mtimeMs >= HOUR_MS;
    } catch {}
    if (!elapsed) return;
    try {
      await fs.promises.copyFile(boardPath, tmp);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (let i = BACKUP_SLOTS - 1; i >= 1; i--) {
      try {
        await fs.promises.rename(bak(i), bak(i + 1));
      } catch {}
    }
    await fs.promises.rename(tmp, bak(1));
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
