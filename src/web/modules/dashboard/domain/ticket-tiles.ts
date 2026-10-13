import {
  attentionTitle,
  needsAttention,
} from "../../../../shared/card-attention.js";
import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import { loopView } from "../../../../shared/loop-view.js";
import type { Card } from "../../../../shared/types.js";
import { hasLoopProgress } from "../../../../shared/running-group.js";
import { clock } from "./usage-meters.js";

export type TileState =
  "stuck" | "needs_input" | "current" | "not_started" | "done";

export const TILE_STATE_ORDER: readonly TileState[] = [
  "stuck",
  "needs_input",
  "current",
  "not_started",
  "done",
];

export interface TicketTile {
  cardId: string;
  identifier: string;
  title: string;
  state: TileState;
  pill: string;
  progress: number | null;
  footer: string | null;
}

export interface LeftItem {
  cardId: string;
  identifier: string;
  state: TileState;
}

const COLUMN_STATES: Record<Card["column"], TileState> = {
  needs_input: "needs_input",
  in_progress: "current",
  todo: "not_started",
  parked: "not_started",
  inbox: "not_started",
  agent_done: "done",
  in_review: "done",
  done: "done",
};

const FINISHED = new Set<Card["column"]>(["agent_done", "in_review", "done"]);

function gateFailed(card: Card): boolean {
  return card.loopProgress?.summary.lastGate?.result === "fail";
}

/** Maps a card to its tile state; an attention claim or a failed gate beats the column. */
export function tileState(card: Card): TileState {
  if (needsAttention(card) || gateFailed(card)) return "stuck";
  return COLUMN_STATES[card.column];
}

function pillOf(card: Card): string {
  const attention = attentionTitle(card);
  if (card.startError) return "Stuck: start failed";
  if (attention === "Session lost") return "Stuck: session lost";
  if (attention !== null) return "Stuck: cleanup blocked";
  if (gateFailed(card)) return "Stuck: gate failed";
  return COLUMN_LABELS[card.column];
}

function footerOf(
  card: Card,
  byId: ReadonlyMap<string, Card>,
  gateText: string | null,
  timeZone: string | undefined,
): string | null {
  const parts: string[] = [];
  if (gateText !== null) parts.push(gateText);
  if (card.dependsOn !== undefined && card.dependsOn.length > 0) {
    const ids = card.dependsOn.map((id) => byId.get(id)?.identifier ?? id);
    parts.push(`Depends on ${ids.join(", ")}`);
  }
  if (card.column === "done" && card.columnSince !== undefined) {
    const time = clock(card.columnSince, timeZone, false);
    if (time !== null) parts.push(`Shipped ${time}`);
  }
  return parts.length === 0 ? null : parts.join(", ");
}

function compareTiles(
  a: { state: TileState; identifier: string },
  b: { state: TileState; identifier: string },
): number {
  return (
    TILE_STATE_ORDER.indexOf(a.state) - TILE_STATE_ORDER.indexOf(b.state) ||
    a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  );
}

/** Builds one tile per card, stuck first, then by identifier. */
export function ticketTiles(
  cards: readonly Card[],
  opts: { timeZone?: string },
): TicketTile[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return cards
    .map((card) => {
      const view = hasLoopProgress(card)
        ? loopView(card.loopProgress, opts)
        : null;
      return {
        cardId: card.id,
        identifier: card.identifier,
        title: card.title,
        state: tileState(card),
        pill: pillOf(card),
        progress: view?.percent ?? null,
        footer: footerOf(card, byId, view?.lastGateText ?? null, opts.timeZone),
      };
    })
    .sort(compareTiles);
}

/** Lists the cards that are not yet at Agent done, In Review or Done, in tile order. */
export function leftOnBoard(cards: readonly Card[]): LeftItem[] {
  return cards
    .filter((card) => !FINISHED.has(card.column))
    .map((card) => ({
      cardId: card.id,
      identifier: card.identifier,
      state: tileState(card),
    }))
    .sort(compareTiles);
}
