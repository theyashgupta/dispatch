import { DONE_STATUSES, formatMinutes } from "../../../../shared/loop-view.js";
import type { LoopProgress } from "../../../../shared/types.js";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Estimates the time left of a loop from the median gap between its passed gates.
 *
 * @remarks The median, not the mean, so one long pause such as a night does not inflate the
 * estimate. A gate stamped after `now` is clock skew and is ignored. A later unit with an unknown phase count makes the result a lower bound.
 */
export function timeLeft(
  progress: LoopProgress,
  now: Date,
): { text: string } | null {
  if (progress.completion === "complete") return null;
  const passed = progress.units
    .flatMap((unit) => unit.phases.map((phase) => phase.passedAt))
    .filter((at): at is string => at !== null)
    .map((at) => Date.parse(at))
    .filter((at) => at <= now.getTime())
    .sort((a, b) => a - b);
  if (passed.length < 2) return { text: "Estimate after 2 gates" };
  const gaps = passed.slice(1).map((at, i) => (at - (passed[i] ?? at)) / 60000);

  const currentNumber = progress.summary.currentUnit;
  const current = progress.units.find((unit) => unit.number === currentNumber);
  let remaining = 0;
  let lowerBound = false;
  if (current !== undefined) {
    const count = current.phaseTotal ?? current.phases.length;
    if (count === 0) lowerBound = true;
    const done = current.phases.filter((phase) => phase.gate === "pass").length;
    remaining += Math.max(0, count - done);
  }
  for (const unit of progress.units) {
    if (unit.number <= (currentNumber ?? 0) || DONE_STATUSES.has(unit.status))
      continue;
    if (unit.phaseTotal === null) lowerBound = true;
    else remaining += unit.phaseTotal;
  }
  const estimate = Math.max(
    10,
    Math.round((median(gaps) * remaining) / 10) * 10,
  );
  return {
    text: `${lowerBound ? "At least" : "About"} ${formatMinutes(estimate)} left`,
  };
}
