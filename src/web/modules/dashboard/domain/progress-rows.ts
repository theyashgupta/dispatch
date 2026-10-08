import { activeSessionView } from "../../../../shared/active-session.js";
import { loopView, type LoopView } from "../../../../shared/loop-view.js";
import type { Card, SupervisorState } from "../../../../shared/types.js";
import { sessionTime } from "./session-time.js";
import { timeLeft } from "./time-left.js";

export interface ProgressRow {
  cardId: string;
  groupId: string;
  slug: string;
  state: SupervisorState | null;
  context: string | null;
  sessionTime: string | null;
  timeLeft: string | null;
  view: LoopView;
}

/**
 * Builds the Section 2 rows: running loops first by group id, then the other loops by group id.
 *
 * @remarks Only a group card with `loopProgress` has a row. A complete loop has no time left, so
 * its badge is null.
 */
export function progressRows(
  cards: readonly Card[],
  now: Date,
  timeZone?: string,
): ProgressRow[] {
  return cards
    .flatMap((card) =>
      card.loopProgress === undefined
        ? []
        : [{ card, progress: card.loopProgress }],
    )
    .sort(
      (a, b) =>
        Number(b.progress.completion === "running") -
          Number(a.progress.completion === "running") ||
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
        slug: progress.slug,
        state: session?.state ?? null,
        context: percent == null ? null : `Context ${Math.round(percent)}%`,
        sessionTime: sessionTime(card, now),
        timeLeft: timeLeft(progress, now)?.text ?? null,
        view: loopView(progress, { timeZone }),
      };
    });
}

/** Builds the Section 2 count text: "2 of 3 loops running", or "2 loops running" with no cap. */
export function loopsRunningText(running: number, cap: number | null): string {
  return cap === null
    ? `${running} ${running === 1 ? "loop" : "loops"} running`
    : `${running} of ${cap} loops running`;
}
