import { isHiddenCard } from "../../../../shared/hidden-card.js";
import type { Card, DecisionItem } from "../../../../shared/types.js";

export interface DecisionOptionView {
  id: string;
  label: string;
  recommended: boolean;
}

export interface DecisionView {
  id: string;
  question: string;
  meta: string;
  options: DecisionOptionView[];
  proposalTitles: string[];
  otherOptionId: string | null;
}

export interface AttentionRow {
  kind: "needs_input" | "permission_prompt";
  cardId: string;
  text: string | null;
  stateSince: string | null;
}

export interface StoredReply {
  result: ReplyResult;
  key: string;
}

export interface StoppedLoop {
  cardId: string;
  stoppedAt: string | null;
  reason: string;
}

export type ReplyResult = "confirmed" | "unconfirmed";

export const REPLY_COPY: Record<ReplyResult, string> = {
  confirmed: "Delivered",
  unconfirmed: "Not confirmed. Check the terminal.",
};

const GATE_KINDS: readonly string[] = ["roadmap_approval", "ticket_proposal"];

const STOP_REASONS: Record<string, string> = {
  usage_stop: "usage limit (policy Stop)",
  budget: "budget reached",
};

/** Format how long ago a decision item was asked, for example "6 min ago". */
export function askedAgo(iso: string, now: number): string {
  const elapsed = now - new Date(iso).getTime();
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(Math.max(0, elapsed) / 60_000);
  if (minutes < 1) return "under 1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * Build the view model of each open decision item.
 *
 * @remarks
 * Options keep their written order and the recommended mark never moves one. The typed answer of "Other answer" rides on the recommended option, else the first option, because the answer route needs an option id of the item. A `roadmap_approval` or `ticket_proposal` item is a binary gate, so it has no other answer.
 */
export function decisionViews(
  items: readonly DecisionItem[],
  orchestratorNames: ReadonlyMap<string, string>,
  now: number,
): DecisionView[] {
  return items
    .filter((item) => item.state === "open")
    .map((item) => {
      const name =
        orchestratorNames.get(item.orchestratorId) ?? item.orchestratorId;
      return {
        id: item.id,
        question: item.question,
        meta: `${item.cardId ?? "Board"}, asked by ${name} ${askedAgo(item.createdAt, now)}`,
        options: item.options.map((option) => ({
          id: option.id,
          label: option.label,
          recommended: option.id === item.recommendedOptionId,
        })),
        proposalTitles:
          item.kind === "ticket_proposal"
            ? (item.proposal?.tickets.map((t) => t.title) ?? [])
            : [],
        otherOptionId: GATE_KINDS.includes(item.kind)
          ? null
          : (item.recommendedOptionId ?? item.options[0]?.id ?? null),
      };
    });
}

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
 * A `permission_prompt` row never carries an approve or deny action. The text is the card status reason, because the snapshot holds no pane text.
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
    } else if (card.state === "needs_input" && !isStopped(card)) {
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

/** The key that ties a reply result to the row it answered: the kind, the state time and the question text. */
export function replyKey(row: AttentionRow): string {
  return JSON.stringify([row.kind, row.stateSince, row.text]);
}

/**
 * Keep the reply results whose row is still listed with the same question and state.
 *
 * @remarks
 * A loop that answers and asks again returns as a new row, so a stored "Delivered" never labels a question nobody answered.
 */
export function liveReplyResults(
  stored: Readonly<Record<string, StoredReply>>,
  rows: readonly AttentionRow[],
): Record<string, ReplyResult> {
  const live: Record<string, ReplyResult> = {};
  for (const row of rows) {
    const reply = stored[row.cardId];
    if (reply !== undefined && reply.key === replyKey(row)) {
      live[row.cardId] = reply.result;
    }
  }
  return live;
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
