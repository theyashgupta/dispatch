import type { BoardCounts, BoardList } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

export async function getBoardList(): Promise<BoardList> {
  const result = await http<BoardList>("/api/boards");
  if (!result.ok) throw httpError("getBoardList", result);
  return result.data;
}

export async function getBoardCounts(): Promise<BoardCounts> {
  const result = await http<BoardCounts>("/api/boards/counts");
  if (!result.ok) throw httpError("getBoardCounts", result);
  return result.data;
}
