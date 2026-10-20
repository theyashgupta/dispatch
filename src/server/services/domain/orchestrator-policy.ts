import type { BoardPolicy, BudgetWarning } from "../../../shared/types.js";

export type PolicyCheck = { ok: true } | { ok: false; reason: string };

/** Refuse a new loop when the running loops already fill the board's concurrency cap. */
export function checkCap({
  policy,
  runningLoops,
}: {
  policy: Pick<BoardPolicy, "concurrencyCap">;
  runningLoops: number;
}): PolicyCheck {
  const cap = policy.concurrencyCap;
  return runningLoops < cap
    ? { ok: true }
    : {
        ok: false,
        reason: `concurrency cap reached: ${runningLoops} of ${cap} loops running`,
      };
}

/**
 * Refuse more work on a group whose cost has reached the board's budget per group.
 *
 * @remarks A null budget means no budget. A cost equal to the budget is refused, the same rule the
 * supervisor pass uses to stop a group.
 */
export function checkBudget({
  policy,
  cost,
}: {
  policy: Pick<BoardPolicy, "budgetPerGroup">;
  cost: number;
}): PolicyCheck {
  const budget = policy.budgetPerGroup;
  return budget == null || cost < budget
    ? { ok: true }
    : { ok: false, reason: `budget reached: cost ${cost} of ${budget}` };
}

/** Refuse a ship action when the board gives the orchestrator no ship rights. */
export function checkShipRights(
  policy: Pick<BoardPolicy, "shipRights">,
): PolicyCheck {
  return policy.shipRights === "none"
    ? { ok: false, reason: "ship rights are none" }
    : { ok: true };
}

/**
 * Decide whether the budget warning mark of a group card is set, cleared or kept.
 *
 * @remarks A mark clears when the budget goes away, or when the budget or percent changed and the
 * cost is below the new threshold. A changed budget or percent that the cost still passes refreshes
 * the mark without a new event. A plain cost drop keeps the mark, because the running cost is in
 * memory and can drop after a server restart.
 */
export function budgetWarningStep({
  budget,
  percent,
  cost,
  mark,
}: {
  budget: number | null;
  percent: number;
  cost: number;
  mark: BudgetWarning | undefined;
}): "set" | "clear" | "refresh" | "keep" {
  if (budget === null) return mark ? "clear" : "keep";
  const threshold = (budget * percent) / 100;
  if (mark) {
    const changed = mark.budget !== budget || mark.percent !== percent;
    if (!changed) return "keep";
    return cost < threshold ? "clear" : "refresh";
  }
  return cost >= threshold ? "set" : "keep";
}
