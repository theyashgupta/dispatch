import { activeSessionView } from "../../../../shared/active-session.js";
import { loopView, type LoopView } from "../../../../shared/loop-view.js";
import {
  hasLoopProgress,
  isRunningGroup,
} from "../../../../shared/running-group.js";
import type {
  Card,
  LoopProgress,
  SupervisorState,
} from "../../../../shared/types.js";
import { sessionTime } from "./session-time.js";
import { timeLeft } from "./time-left.js";

export interface ProgressRow {
  cardId: string;
  groupId: string;
  slug: string | null;
  state: SupervisorState | null;
  context: string | null;
  sessionTime: string | null;
  timeLeft: string | null;
  view: LoopView | null;
}

/**
 * Builds the Section 2 rows: running groups first by group id, then the other loops by group id.
 *
 * @remarks A card with loop progress that has at least one unit has a loop row. A running group
 * with no loop progress, or with zero units, has one row with a null view. Any other card has no row.
 */
export function progressRows(
  cards: readonly Card[],
  now: Date,
  timeZone?: string,
): ProgressRow[] {
  const running = (progress: LoopProgress | null) =>
    (progress?.completion ?? "running") === "running";
  return cards
    .flatMap((card) => {
      const progress = hasLoopProgress(card) ? card.loopProgress : null;
      return progress !== null || isRunningGroup(card)
        ? [{ card, progress }]
        : [];
    })
    .sort(
      (a, b) =>
        Number(running(b.progress)) - Number(running(a.progress)) ||
        a.card.identifier.localeCompare(b.card.identifier, undefined, {
          numeric: true,
        }),
    )
    .map(({ card, progress }) => {
      const session = activeSessionView(card);
      const percent = session?.contextPercent;
      return {
        cardId: card.id,
        groupId: card.identifier,
        slug: progress?.slug ?? null,
        state: session?.state ?? null,
        context: percent == null ? null : `Context ${Math.round(percent)}%`,
        sessionTime: sessionTime(card, now),
        timeLeft:
          progress === null ? null : (timeLeft(progress, now)?.text ?? null),
        view: progress === null ? null : loopView(progress, { timeZone }),
      };
    });
}

/** Builds the Section 2 count text: "2 of 3 loops running", or "2 loops running" with no cap. */
export function loopsRunningText(running: number, cap: number | null): string {
  return cap === null
    ? `${running} ${running === 1 ? "loop" : "loops"} running`
    : `${running} of ${cap} loops running`;
}
