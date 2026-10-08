import { isHiddenCard } from "../../../../shared/hidden-card.js";
import type { DecisionView } from "../../../../shared/decision-view.js";
import type { Card } from "../../../../shared/types.js";

export interface AttentionRow {
  kind: "needs_input" | "permission_prompt";
  cardId: string;
  text: string | null;
  stateSince: string | null;
}

export interface StoppedLoop {
  cardId: string;
  stoppedAt: string | null;
  reason: string;
}

const STOP_REASONS: Record<string, string> = {
  usage_stop: "usage limit (policy Stop)",
  budget: "budget reached",
};

function groupCards(cards: readonly Card[]): Card[] {
  return cards.filter((c) => c.source === "group" && !isHiddenCard(c));
}

function isStopped(card: Card): boolean {
  return (
    card.state === "needs_input" &&
    card.stateReason !== undefined &&
    Object.hasOwn(STOP_REASONS, card.stateReason)
  );
}

/**
 * List the group loops that wait on the user in the Decisions tab: a reply at `needs_input` and the prompt text at `permission_prompt`.
 *
 * @remarks
 * A `permission_prompt` row never carries an approve or deny action. A failed resume gets no reply row, because its pane may be a shell; the dashboard offers "Try resume again" for it.
 */
export function attentionRows(cards: readonly Card[]): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const card of groupCards(cards)) {
    if (card.state === "permission_prompt") {
      rows.push({
        kind: "permission_prompt",
        cardId: card.id,
        text: card.statusReason ?? null,
        stateSince: card.stateSince ?? null,
      });
    } else if (
      card.state === "needs_input" &&
      !isStopped(card) &&
      card.stateReason !== "resume_failed"
    ) {
      rows.push({
        kind: "needs_input",
        cardId: card.id,
        text: card.statusReason ?? null,
        stateSince: card.stateSince ?? null,
      });
    }
  }
  return rows;
}

/** List the group loops that only the user can resume: `needs_input` with the reason `usage_stop` or `budget`. */
export function stoppedLoops(cards: readonly Card[]): StoppedLoop[] {
  return groupCards(cards)
    .filter(isStopped)
    .map((card) => ({
      cardId: card.id,
      stoppedAt: card.stateSince ?? null,
      reason: STOP_REASONS[card.stateReason ?? ""] ?? "",
    }));
}

/** The text of a stopped loop row for a formatted stop time. */
export function stoppedLoopText(loop: StoppedLoop, time: string): string {
  return `${loop.cardId} stopped at ${time}: ${loop.reason}`;
}

/** The count shown in the tab label: every row the Decisions tab lists. */
export function decisionCount(
  views: readonly DecisionView[],
  rows: readonly AttentionRow[],
): number {
  return views.length + rows.length;
}
