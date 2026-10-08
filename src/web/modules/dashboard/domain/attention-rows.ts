import { activeSessionView } from "../../../../shared/active-session.js";
import type { AttentionItem } from "../../../../shared/attention-queue.js";
import { withBoard } from "../../../../shared/board-select.js";
import {
  REPLY_COPY,
  type DecisionView,
  type ReplyResult,
} from "../../../../shared/decision-view.js";
import { SESSION_STATES } from "../../../../shared/session-states.js";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type BoardKey,
  type Card,
  type ClaudeAccountSummary,
  type SupervisorState,
} from "../../../../shared/types.js";
import { dollars } from "./cost-rows.js";
import { accountFor, clock } from "./usage-meters.js";

export type AttentionBadge =
  { kind: "state"; state: SupervisorState } | { kind: "label"; label: string };

export type AttentionAction = "resume" | "retry_resume";

export const ACTION_LABELS: Record<AttentionAction, string> = {
  resume: "Resume loop",
  retry_resume: "Try resume again",
};

export type AttentionRow =
  | { type: "decision"; id: string; view: DecisionView }
  | {
      type: "reply";
      id: string;
      kind: "needs_input" | "stale" | "permission_prompt";
      cardId: string;
      title: string;
      text: string | null;
      waiting: string;
      stateSince: string;
    }
  | {
      type: "item";
      id: string;
      cardId: string | null;
      title: string | null;
      badge: AttentionBadge | null;
      waiting: string;
      body: string | null;
      action: AttentionAction | null;
      changeBudgetHref: string | null;
    };

export interface AttentionContext {
  boardKey: BoardKey;
  cards: readonly Card[];
  accounts: readonly ClaudeAccountSummary[];
  groups: readonly { cardId: string; cost: number; budget: number | null }[];
  decisions: readonly DecisionView[];
  timeZone?: string;
}

function resetTime(card: Card | undefined, ctx: AttentionContext) {
  const session = card === undefined ? null : activeSessionView(card);
  const account = accountFor(
    ctx.accounts,
    session?.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID,
  );
  const iso =
    account?.limitedUntil ??
    account?.buckets.find((bucket) => bucket.kind === "five_hour")?.resetsAt;
  return iso == null ? null : clock(iso, ctx.timeZone, false);
}

function budgetText(item: AttentionItem, ctx: AttentionContext): string {
  const group = ctx.groups.find((g) => g.cardId === item.cardId);
  return group === undefined || group.budget === null
    ? "Budget reached."
    : `Budget reached: ${dollars(group.cost)} of ${dollars(group.budget)}.`;
}

function gateText(item: AttentionItem): string {
  const { gate } = item;
  if (gate === undefined) return "";
  const limit = gate.limit === null ? "" : ` of ${gate.limit}`;
  return `Phase ${gate.phase} gate failed, attempt ${gate.attempt}${limit}.`;
}

function resumeText(item: AttentionItem): string {
  const lead =
    item.lost === true
      ? "The session was lost and the resume failed"
      : "Claude exited and the resume failed";
  return item.text === null ? `${lead}.` : `${lead}: ${item.text}.`;
}

function badgeOf(item: AttentionItem): AttentionBadge | null {
  if (item.kind === "decision") return { kind: "label", label: "Decision" };
  if (item.kind === "failed_gate") {
    return { kind: "label", label: "Failed gate" };
  }
  return item.state === null ? null : { kind: "state", state: item.state };
}

function bodyOf(item: AttentionItem, ctx: AttentionContext): string | null {
  switch (item.kind) {
    case "usage_stop": {
      const time = resetTime(
        ctx.cards.find((card) => card.id === item.cardId),
        ctx,
      );
      return time === null
        ? "Stopped at the usage limit."
        : `Stopped at the usage limit. The limit resets at ${time}.`;
    }
    case "budget_stop":
      return budgetText(item, ctx);
    case "failed_gate":
      return gateText(item);
    case "resume_failed":
      return resumeText(item);
    default:
      return item.text;
  }
}

const ACTIONS: Partial<Record<AttentionItem["kind"], AttentionAction>> = {
  usage_stop: "resume",
  budget_stop: "resume",
  resume_failed: "retry_resume",
};

function itemRow(item: AttentionItem, ctx: AttentionContext): AttentionRow {
  const waiting = `waiting ${item.waitMinutes} min`;
  if (item.kind === "decision") {
    const view = ctx.decisions.find((d) => `decision:${d.id}` === item.id);
    if (view !== undefined) return { type: "decision", id: item.id, view };
  }
  if (
    item.cardId !== null &&
    (item.kind === "needs_input" ||
      item.kind === "stale" ||
      item.kind === "permission_prompt") &&
    (item.reply || item.kind === "permission_prompt")
  ) {
    return {
      type: "reply",
      id: item.id,
      kind: item.kind,
      cardId: item.cardId,
      title: item.groupId ?? item.cardId,
      text: item.text,
      waiting,
      stateSince: item.waitingSince,
    };
  }
  return {
    type: "item",
    id: item.id,
    cardId: item.cardId,
    title: item.groupId,
    badge: badgeOf(item),
    waiting,
    body: bodyOf(item, ctx),
    action: ACTIONS[item.kind] ?? null,
    changeBudgetHref:
      item.kind === "budget_stop"
        ? withBoard("#/board?panel=orchestrator&tab=policy", ctx.boardKey)
        : null,
  };
}

/**
 * Turns the attention queue into the rows of Section 1: a decision card, a reply card or an item card.
 *
 * @remarks A decision row needs its open item in `ctx.decisions`; a decision the list no longer holds falls back to an item card with its question.
 */
export function attentionRows(
  items: readonly AttentionItem[],
  ctx: AttentionContext,
): AttentionRow[] {
  return items.map((item) => itemRow(item, ctx));
}

export const ACTIONS_OFF =
  "Reconnecting. Actions are off until the board stream is back.";

/** The line under a reply after the send, for a confirmed or unconfirmed send or a refusal. */
export function replyResultText(
  outcome:
    | { ok: true; result: ReplyResult | null }
    | { ok: false; error: string; reason: string | null },
  title: string,
  state: SupervisorState | undefined,
): string | null {
  if (outcome.ok) return REPLY_COPY[outcome.result ?? "unconfirmed"];
  if (outcome.error !== "session-state-refused") return null;
  const label =
    state === undefined ? "another state" : SESSION_STATES[state].label;
  return `Not sent. ${title} is now at ${label}. Open the terminal.`;
}
