import type { DecisionItem } from "./types.js";

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

export type ReplyResult = "confirmed" | "unconfirmed";

export const REPLY_COPY: Record<ReplyResult, string> = {
  confirmed: "Delivered",
  unconfirmed: "Not confirmed. Check the terminal.",
};

export interface StoredReply<T = ReplyResult> {
  result: T;
  key: string;
}

export interface ReplyRow {
  kind: string;
  cardId: string;
  text: string | null;
  stateSince: string | null;
}

const GATE_KINDS: readonly string[] = ["roadmap_approval", "ticket_proposal"];

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

/**
 * The key that ties a reply result to the row it answered: the kind, the state time and the question text.
 *
 * @remarks A stale row leaves out the text because it holds the wait minutes and changes every minute.
 */
export function replyKey(row: Omit<ReplyRow, "cardId">): string {
  return JSON.stringify(
    row.kind === "stale"
      ? [row.kind, row.stateSince]
      : [row.kind, row.stateSince, row.text],
  );
}

/**
 * Keep the reply results whose row is still listed with the same question and state, keyed by card id.
 *
 * @remarks
 * A loop that answers and asks again returns as a new row, so a stored "Delivered" never labels a question nobody answered.
 */
export function liveReplyResults<T>(
  stored: Readonly<Record<string, StoredReply<T>>>,
  rows: readonly ReplyRow[],
): Record<string, T> {
  const live: Record<string, T> = {};
  for (const row of rows) {
    const reply = stored[row.cardId];
    if (reply !== undefined && reply.key === replyKey(row)) {
      live[row.cardId] = reply.result;
    }
  }
  return live;
}

/** The toast or error line of a failed action, for example "Resume loop failed: no-live-session.". */
export function actionFailedText(action: string, message: string): string {
  return `${action} failed: ${message.replace(/\.+$/, "")}.`;
}
