import { withBoard } from "../../shared/board-select.js";
import type { BoardKey, BoardSnapshot } from "../../shared/types.js";
import { http } from "@/lib/http";

export async function fetchBoardSnapshot(
  board: BoardKey,
  doneLimit: number,
): Promise<BoardSnapshot> {
  const result = await http<BoardSnapshot>(
    withBoard(`/api/board?doneLimit=${doneLimit}`, board),
  );
  if (!result.ok) throw new Error(`board snapshot failed: ${result.status}`);
  if (typeof result.data !== "object" || result.data === null) {
    throw new Error("board snapshot failed: unreadable body");
  }
  return result.data;
}
