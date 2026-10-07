import type {
  BoardKey,
  OrchestrationEvent,
  OrchestrationEventKind,
} from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";

export interface WaitFilter {
  since: number;
  kinds?: OrchestrationEventKind[] | undefined;
  cardIds?: string[] | undefined;
}

export type WaitResult =
  { event: OrchestrationEvent } | { timedOut: true; cursor: number };

const SCAN_LIMIT = 200;

/**
 * Whether an event is one the wait is for.
 *
 * @remarks A `tool_call` row never matches unless `kinds` names it, else every orchestrator call,
 * the wait call's own record included, would end every wait.
 */
function matches(event: OrchestrationEvent, filter: WaitFilter): boolean {
  if (event.id <= filter.since) return false;
  if (filter.kinds) {
    if (!filter.kinds.includes(event.kind)) return false;
  } else if (event.kind === "tool_call") {
    return false;
  }
  return (
    !filter.cardIds ||
    (event.cardId !== null && filter.cardIds.includes(event.cardId))
  );
}

/**
 * Wait for the first event of a board that matches, or for the time limit.
 *
 * @remarks An event already after `since` answers at once. The timeout cursor is the largest event
 * id of the board seen, so the caller resumes from it without a gap. `signal` ends the wait with no
 * answer and leaves no listener or timer behind.
 */
export function waitForEvent(
  board: BoardKey,
  filter: WaitFilter,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WaitResult | null> {
  let cursor = filter.since;
  for (;;) {
    const page = store.listOrchestrationEvents(board, cursor, SCAN_LIMIT);
    const present = page.find((event) => matches(event, filter));
    if (present) return Promise.resolve({ event: present });
    cursor = page.at(-1)?.id ?? cursor;
    if (page.length < SCAN_LIMIT) break;
  }

  return new Promise((resolve) => {
    const finish = (result: WaitResult | null): void => {
      clearTimeout(timer);
      store.off("orchestration", onEvent);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onEvent = (event: OrchestrationEvent): void => {
      if (event.boardKey !== board) return;
      cursor = Math.max(cursor, event.id);
      if (matches(event, filter)) finish({ event });
    };
    const onAbort = (): void => finish(null);
    const timer = setTimeout(
      () => finish({ timedOut: true, cursor }),
      timeoutMs,
    );
    store.on("orchestration", onEvent);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
