import type {
  AccountSessionEntry,
  ApplyChoice,
} from "../../../../shared/types.js";

type CountedSession = Pick<AccountSessionEntry, "accountId" | "turn">;

/**
 * Count the sessions each apply choice changes when the active account becomes `targetId`.
 *
 * @remarks
 * A session already on the target never counts. `idle` moves idle and limit sessions now, `all`
 * adds the busy and unknown ones, which the server queues for the end of their turn.
 */
export function switchCounts(
  sessions: readonly CountedSession[],
  targetId: string,
): Record<ApplyChoice, number> {
  const movable = sessions.filter((s) => s.accountId !== targetId);
  return {
    none: 0,
    idle: movable.filter((s) => s.turn === "idle" || s.turn === "limit").length,
    all: movable.length,
  };
}

/**
 * Build the notice that reports how many running sessions a switch moved, queued and skipped.
 */
export function resultNotice(
  moved: number,
  queued: number,
  skipped: number,
): string {
  const parts = [`Moved ${moved}`, `queued ${queued}`];
  if (skipped > 0) parts.push(`skipped ${skipped}`);
  return `${parts.join(", ")}.`;
}
