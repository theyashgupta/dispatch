import type { Card } from "../../../../shared/types.js";
import { dollars } from "./cost-rows.js";

export const NEEDS_YOUR_CALL_ID = "needs-your-call";

export interface NextStep {
  headline: string;
  detail: string;
}

/** Counts the phase gates that passed on the calendar day of `now` in the given time zone. */
export function gatesPassedToday(
  cards: readonly Card[],
  now: Date,
  timeZone?: string,
): number {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = format.format(now);
  return cards
    .flatMap((card) => card.loopProgress?.units ?? [])
    .flatMap((unit) => unit.phases)
    .filter(
      (phase) =>
        phase.gate === "pass" &&
        phase.passedAt !== null &&
        !Number.isNaN(Date.parse(phase.passedAt)) &&
        format.format(new Date(phase.passedAt)) === today,
    ).length;
}

export function gatesText(count: number): string {
  return `${count} ${count === 1 ? "gate" : "gates"} passed today`;
}

export function spentText(groups: readonly { cost: number }[]): string {
  return `${dollars(groups.reduce((sum, group) => sum + group.cost, 0))} spent`;
}

export function needsCallText(count: number): string {
  if (count === 0) return "nothing needs you";
  return count === 1 ? "1 needs a call" : `${count} need a call`;
}

/** Names the unit and phase that the first running loop works on. */
export function nextStep(cards: readonly Card[]): NextStep {
  const candidates = cards
    .flatMap((card) => {
      const progress = card.loopProgress;
      if (progress?.completion !== "running") return [];
      const unit = progress.units.find(
        (u) => u.number === progress.summary.currentUnit,
      );
      return unit === undefined ? [] : [{ card, progress, unit }];
    })
    .sort((a, b) =>
      a.card.identifier.localeCompare(b.card.identifier, undefined, {
        numeric: true,
      }),
    );
  const first = candidates[0];
  if (first === undefined) {
    return {
      headline: "No loop running",
      detail: "Start a group from the board.",
    };
  }
  const { card, progress, unit } = first;
  const phase = progress.summary.currentPhase;
  const total = unit.phaseTotal ?? unit.phases.length;
  let detail = `Unit ${unit.number} of ${progress.summary.unitsTotal}`;
  if (phase !== null) {
    detail =
      total === 0
        ? `Phase ${phase.number}: ${phase.name}`
        : `Phase ${phase.number} of ${total}: ${phase.name}`;
  }
  return {
    headline: `${card.identifier} unit ${unit.number}: ${unit.title}`,
    detail,
  };
}
