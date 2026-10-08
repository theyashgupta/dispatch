import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { BoardSnapshot } from "../../../../shared/types.js";

/**
 * True when a snapshot only seeds the previous columns: the first after a connect, or the first of another board.
 *
 * @remarks A null `seededBoard` means nothing is seeded.
 */
export function needsSeed(
  seededBoard: string | null,
  snapshot: BoardSnapshot,
): boolean {
  return seededBoard !== (snapshot.boardKey ?? DEFAULT_BOARD_KEY);
}
