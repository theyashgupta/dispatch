import type { LoopProgress, LoopUnit } from "./types.js";

export type SegmentState = "done" | "current" | "pending" | "failed gate";

export interface LoopSegment {
  unit: number;
  state: SegmentState;
  accessibleName: string;
}

export interface LoopView {
  percent: number;
  label: string;
  segments: LoopSegment[];
  lastGateText: string | null;
}

export const DONE_STATUSES: ReadonlySet<LoopUnit["status"]> = new Set([
  "shipped",
  "built, awaiting /ship",
]);

function phaseCountOf(unit: LoopUnit | undefined): number | null {
  if (unit === undefined) return null;
  const count = unit.phaseTotal ?? unit.phases.length;
  return count > 0 ? count : null;
}

function passedIn(unit: LoopUnit | undefined): number {
  return unit?.phases.filter((phase) => phase.gate === "pass").length ?? 0;
}

function clockTime(iso: string, timeZone: string | undefined): string | null {
  if (Number.isNaN(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

function percentOf(progress: LoopProgress, current: LoopUnit | undefined) {
  const { unitsDone, unitsTotal } = progress.summary;
  if (progress.completion === "complete") return 100;
  if (unitsTotal === 0) return 0;
  const phaseCount = phaseCountOf(current);
  const fraction =
    phaseCount === null
      ? 0
      : Math.min(passedIn(current), phaseCount) / phaseCount;
  return Math.floor((100 * (unitsDone + fraction)) / unitsTotal);
}

function labelOf(progress: LoopProgress, current: LoopUnit | undefined) {
  const { unitsDone, unitsTotal, currentPhase } = progress.summary;
  if (progress.units.length === 0) return "No units";
  if (progress.completion === "complete") {
    return progress.units.every((unit) => unit.status === "shipped")
      ? `${unitsTotal} of ${unitsTotal} units shipped`
      : `${unitsTotal} of ${unitsTotal} units built, awaiting ship`;
  }
  if (current !== undefined && currentPhase !== null) {
    const count = phaseCountOf(current);
    const position = `Unit ${current.number} of ${unitsTotal}, phase ${currentPhase.number}`;
    return count === null ? position : `${position} of ${count}`;
  }
  if (current !== undefined) return `Unit ${current.number} of ${unitsTotal}`;
  const next = progress.units.find((unit) => !DONE_STATUSES.has(unit.status));
  return next === undefined
    ? `${unitsDone} of ${unitsTotal} units built`
    : `${unitsDone} of ${unitsTotal} units built, unit ${next.number} not started`;
}

function lastGateTextOf(progress: LoopProgress, timeZone: string | undefined) {
  const gate = progress.summary.lastGate;
  if (gate === null) return null;
  const time = clockTime(gate.at, timeZone);
  const when = time === null ? "" : ` ${time}`;
  if (gate.result === "pass") return `Phase ${gate.phase} gate passed${when}`;
  const phase = progress.units
    .find((unit) => unit.number === gate.unit)
    ?.phases.find((candidate) => candidate.number === gate.phase);
  const limit = phase?.retryBudget ?? null;
  const attempt = `attempt ${phase?.attempts ?? 1}`;
  const text = `Phase ${gate.phase} gate failed${when}, ${attempt}`;
  return limit === null ? text : `${text} of ${limit}`;
}

function segmentState(progress: LoopProgress, unit: LoopUnit): SegmentState {
  const { currentUnit, lastGate } = progress.summary;
  if (unit.number === currentUnit) {
    return lastGate?.result === "fail" && lastGate.unit === unit.number
      ? "failed gate"
      : "current";
  }
  if (DONE_STATUSES.has(unit.status)) return "done";
  return unit.status === "blocked" ? "current" : "pending";
}

/**
 * Turns loop progress into the model of the dashboard progress row.
 *
 * @remarks The percent counts passed gates of the current unit as a fraction of its phase count, so
 * the bar moves inside a unit and not only when a unit ends. A complete loop reads 100.
 */
export function loopView(
  progress: LoopProgress,
  opts: { timeZone?: string },
): LoopView {
  const current = progress.units.find(
    (unit) => unit.number === progress.summary.currentUnit,
  );
  return {
    percent: percentOf(progress, current),
    label: labelOf(progress, current),
    segments: progress.units.map((unit) => {
      const state = segmentState(progress, unit);
      return {
        unit: unit.number,
        state,
        accessibleName: `Unit ${unit.number}: ${unit.title}, ${state}`,
      };
    }),
    lastGateText: lastGateTextOf(progress, opts.timeZone),
  };
}

/** Formats a minute count as "45 min", "3 h" or "2 h 10 min". */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
