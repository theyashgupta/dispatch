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

/** The toast or error line of a failed action, for example "Resume loop failed: there is no open session.". */
export function actionFailedText(action: string, message: string): string {
  return `${action} failed: ${message.replace(/\.+$/, "")}.`;
}

const REFUSALS: Record<string, string> = {
  "supervisor-off": "the supervisor is off",
  "orchestrator-running": "it is already running",
  "orchestrator-session-live": "the session is still open, resume it",
  "orchestrator-not-resumable": "there is nothing to resume",
  "orchestrator-not-running": "it is not running",
  "orchestrator-busy": "the orchestrator is busy, try again in a moment",
  "orchestrator-start-failed": "the orchestrator did not start",
  "orchestrator-resume-failed": "the orchestrator did not resume",
  "unknown-orchestrator": "that orchestrator no longer exists",
  "unknown-board": "that board no longer exists",
  "unknown-card": "that card no longer exists",
  "duplicate-id": "an orchestrator with this id already exists",
  "main-exists": "this board already has a main orchestrator",
  "extra-needs-main": "the main orchestrator has to exist first",
  "main-has-scope": "the main orchestrator cannot have a group or a ticket",
  "main-has-override": "the main orchestrator cannot have a policy override",
  "extra-needs-scope": "an extra orchestrator needs a group or a ticket",
  "group-owned": "another extra orchestrator owns one of the groups",
  "ticket-owned": "another extra orchestrator owns one of the tickets",
  "wider-override": "an override is wider than the board policy",
  "empty-patch": "there is nothing to change",
  "invalid-id":
    "the id has to be 2 to 21 characters: a lowercase letter, then lowercase letters, digits or hyphens",
  "invalid-orchestrator-id": "that orchestrator id is not valid",
  "invalid-name": "the name has to be 1 to 60 characters",
  "invalid-role": "the role has to be main or extra",
  "invalid-groupIds": "the group list is not valid",
  "invalid-ticketIds": "the ticket list is not valid",
  "invalid-card-id": "that card id is not valid",
  "invalid-roadmapApproval": "the approval mode has to be ask, rules or all",
  "invalid-usageLimit": "usage limit has to be wait or stop",
  "invalid-shipRights": "ship rights has to be none, open PRs or merge",
  "invalid-supervisor": "the supervisor has to be on or off",
  "invalid-loopModel": "the loop model is not a supported model",
  "invalid-orchestratorModel":
    "the orchestrator model is not a supported model",
  "invalid-concurrencyCap": "loops at once has to be a number from 1 to 10",
  "invalid-handoffPercent": "handoff has to be a number from 10 to 95",
  "invalid-handoffHardPercent":
    "hard handoff has to be a number above the handoff percent, up to 100",
  "hard-below-handoff":
    "hard handoff has to be a number above the handoff percent, up to 100",
  "invalid-budgetPerGroup":
    "the budget has to be an amount above 0 and at most 100000",
  "invalid-policy": "the policy has a field that is not valid",
  "unknown-field": "the request has a field that is not allowed",
  "invalid-body": "the request is not valid",
  "invalid-text": "the text is empty or starts with a mode character",
  "session-state-refused": "the session is at a prompt that cannot take text",
  "no-live-session": "there is no open session",
  "session-busy": "the session is busy, try again in a moment",
  "no-loop": "there is no loop for this card",
  "ship-running": "a ship is running",
  "not-resumable": "the session is not waiting to be resumed",
  "unknown-decision": "that decision no longer exists",
  "already-answered": "the decision is already answered",
  "invalid-option": "that option is not valid for this decision",
  "invalid-note": "the note is too long",
  "invalid-state": "the decision state has to be open or answered",
  "session is already live": "the session is already open",
  "card has no lost session to resume": "there is no lost session to resume",
  "card has no workspace to resume": "the card has no workspace to resume",
  "a start is in flight for this card": "a start is already running",
};
const GENERIC_REFUSAL = "the request failed";

/**
 * Turn a refusal code and optional server reason into plain text for a toast or an error line.
 *
 * @remarks
 * A mapped code wins over the server reason. An unmapped code with a reason shows the reason, and one without shows a sentence that names the code, so support can trace it.
 */
export function refusalText(
  code: string | null,
  reason: string | null,
): string {
  const key = code === "policy-refused" ? reason : code;
  if (key !== null && Object.hasOwn(REFUSALS, key)) return REFUSALS[key];
  if (reason !== null) return reason;
  return code === null ? GENERIC_REFUSAL : `${GENERIC_REFUSAL} (${code})`;
}
