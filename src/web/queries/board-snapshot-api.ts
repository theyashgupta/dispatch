import type { BoardSnapshot } from "../../shared/types.js";
import { http } from "@/lib/http";

export async function fetchBoardSnapshot(
  doneLimit: number,
): Promise<BoardSnapshot> {
  const result = await http<BoardSnapshot>(`/api/board?doneLimit=${doneLimit}`);
  if (!result.ok) throw new Error(`board snapshot failed: ${result.status}`);
  if (typeof result.data !== "object" || result.data === null) {
    throw new Error("board snapshot failed: unreadable body");
  }
  return result.data;
}
