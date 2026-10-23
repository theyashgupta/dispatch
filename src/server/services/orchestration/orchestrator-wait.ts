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
  orchestratorId?: string | undefined;
}

export type WaitResult =
  | { event: OrchestrationEvent }
  | { timedOut: true; cursor: number; machineWake?: true };

export interface WaitClock {
  now: () => number;
  pollMs: number;
}

const DEFAULT_CLOCK: WaitClock = { now: Date.now, pollMs: 1_000 };
const SCAN_LIMIT = 200;
const SLEPT_MS = 30_000;

/**
 * Whether an event is one the wait is for.
 *
 * @remarks A `tool_call` row never matches unless `kinds` names it, else every orchestrator call,
 * the wait call's own record included, would end every wait. An `intake_submitted` row names its
 * target orchestrator and matches only that one when the filter sets `orchestratorId`. A
 * `machine_wake` row ends any wait it arrives during (`live`), so a repeated old `since` never
 * loops on it.
 */
function matches(
  event: OrchestrationEvent,
  filter: WaitFilter,
  live = false,
): boolean {
  if (event.id <= filter.since) return false;
  if (live && event.kind === "machine_wake") return true;
  if (filter.kinds) {
    if (!filter.kinds.includes(event.kind)) return false;
  } else if (event.kind === "tool_call") {
    return false;
  }
  if (
    event.kind === "intake_submitted" &&
    filter.orchestratorId !== undefined &&
    event.data.orchestratorId !== filter.orchestratorId
  ) {
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
 * @remarks An event already after `since` answers at once, and the timeout cursor is the largest
 * event id seen. The deadline is read from the wall clock once per poll interval, because a
 * monotonic timer stops while the machine sleeps, and a poll gap over the interval plus 30 s ends
 * the wait with `machineWake`. `signal` ends the wait with no answer and leaves no listener or timer.
 */
export function waitForEvent(
  board: BoardKey,
  filter: WaitFilter,
  timeoutMs: number,
  signal?: AbortSignal,
  clock: WaitClock = DEFAULT_CLOCK,
): Promise<WaitResult | null> {
  let cursor = filter.since;
  for (;;) {
    const page = store.listOrchestrationEvents(board, cursor, SCAN_LIMIT);
    const present = page.find((event) => matches(event, filter));
    if (present) return Promise.resolve({ event: present });
    cursor = page.at(-1)?.id ?? cursor;
    if (page.length < SCAN_LIMIT) break;
  }

  const deadline = clock.now() + timeoutMs;
  let last = clock.now();
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
      if (matches(event, filter, true)) finish({ event });
    };
    const onAbort = (): void => finish(null);
    const tick = (): void => {
      const now = clock.now();
      const slept = now - last > clock.pollMs + SLEPT_MS;
      last = now;
      if (slept) finish({ timedOut: true, cursor, machineWake: true });
      else if (now >= deadline) finish({ timedOut: true, cursor });
      else timer = setTimeout(tick, Math.min(clock.pollMs, deadline - now));
    };
    let timer = setTimeout(tick, Math.min(clock.pollMs, timeoutMs));
    store.on("orchestration", onEvent);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
