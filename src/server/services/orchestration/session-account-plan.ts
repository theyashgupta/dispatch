import type {
  ApplyChoice,
  SessionRef,
  SessionTurnState,
} from "../../../shared/types.js";

export interface PlanSession extends SessionRef {
  accountId: string;
  turn: SessionTurnState;
  lost: boolean;
  legacy: boolean;
}

interface SessionPlan {
  move: SessionRef[];
  queue: SessionRef[];
  skip: (SessionRef & { reason: "same" | "lost" | "legacy" | "busy" })[];
}

/**
 * Plan which running sessions an account switch moves now, queues, or leaves alone.
 *
 * @remarks A session on the target, a lost session and a legacy session are
 * skipped under every other choice. An `unknown` turn reads as busy, because Claude must never be
 * stopped at an unproven safe point.
 */
export function planApply(
  sessions: readonly PlanSession[],
  choice: Exclude<ApplyChoice, "none">,
  targetId: string,
): SessionPlan {
  const plan: SessionPlan = { move: [], queue: [], skip: [] };
  for (const s of sessions) {
    const ref = { cardId: s.cardId, sessionId: s.sessionId };
    if (s.accountId === targetId) plan.skip.push({ ...ref, reason: "same" });
    else if (s.lost) plan.skip.push({ ...ref, reason: "lost" });
    else if (s.legacy) plan.skip.push({ ...ref, reason: "legacy" });
    else if (s.turn === "idle" || s.turn === "limit") plan.move.push(ref);
    else if (choice === "all") plan.queue.push(ref);
    else plan.skip.push({ ...ref, reason: "busy" });
  }
  return plan;
}
