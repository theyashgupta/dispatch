import { withBoard } from "../../shared/board-select.js";
import type { BoardKey, Card, SettableItemState } from "../../shared/types.js";
import { http } from "@/lib/http";

async function postItem<T = unknown>(
  id: string,
  path: string,
  body?: object,
  board?: BoardKey,
): Promise<T> {
  const url = `/api/items/${encodeURIComponent(id)}/${path}`;
  const result = await http<T>(
    board === undefined ? url : withBoard(url, board),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!result.ok) {
    throw new Error(result.error ?? `${path} failed: ${result.status}`);
  }
  return result.data;
}

/** Set an item's state; a refused change (unknown or promoted) rejects with the server's reason. */
export async function setItemState(
  id: string,
  state: SettableItemState,
): Promise<void> {
  await postItem(id, "state", { state });
}

/** Snooze an item until an ISO time; a refused snooze rejects with the server's reason. */
export async function snoozeItem(id: string, until: string): Promise<void> {
  await postItem(id, "snooze", { until });
}

/** Promote an item to a local Inbox card, optionally with a context block; repeats return the same card. */
export async function promoteItem(
  board: BoardKey,
  id: string,
  context?: string,
): Promise<{ card: Card }> {
  return postItem<{ card: Card }>(
    id,
    "promote",
    context !== undefined ? { context } : undefined,
    board,
  );
}
