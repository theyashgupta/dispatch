import { activeSessionView, type ActiveSessionView } from "./active-session.js";
import { DEFAULT_BOARD_KEY } from "./board-key.js";
import { STALE_MINUTES } from "./orchestrator-limits.js";
import type {
  BoardKey,
  Card,
  DecisionItem,
  OrchestrationEvent,
  SupervisorState,
} from "./types.js";

export type AttentionKind =
  | "decision"
  | "needs_input"
  | "stale"
  | "permission_prompt"
  | "usage_stop"
  | "budget_stop"
  | "failed_gate"
  | "resume_failed";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  cardId: string | null;
  groupId: string | null;
  state: SupervisorState | null;
  waitingSince: string;
  waitMinutes: number;
  text: string | null;
  reply: boolean;
  lost?: boolean;
  gate?: { unit: number; phase: number; attempt: number; limit: number | null };
}

function waitMinutesOf(since: string, now: Date): number {
  const minutes = Math.floor((now.getTime() - Date.parse(since)) / 60000);
  return Number.isNaN(minutes) ? 0 : Math.max(0, minutes);
}

function permissionEvidence(
  events: readonly OrchestrationEvent[],
  sessionId: string,
): string | null {
  let newest: OrchestrationEvent | null = null;
  for (const event of events) {
    if (
      event.kind !== "supervisor_state" ||
      event.sessionId !== sessionId ||
      event.data.to !== "permission_prompt"
    ) {
      continue;
    }
    if (
      newest === null ||
      event.ts > newest.ts ||
      (event.ts === newest.ts && event.id > newest.id)
    ) {
      newest = event;
    }
  }
  const evidence = newest?.data.evidence;
  return typeof evidence === "string" ? evidence : null;
}

function sessionItem(
  card: Card,
  session: ActiveSessionView,
  events: readonly OrchestrationEvent[],
  now: Date,
): AttentionItem | null {
  const state = session.state;
  if (state === undefined) return null;
  const waitingSince =
    session.stateSince ?? session.updatedAt ?? card.updatedAt;
  const waitMinutes = waitMinutesOf(waitingSince, now);
  const base = {
    cardId: card.id,
    groupId: card.identifier,
    state,
    waitingSince,
    waitMinutes,
  };
  const make = (
    kind: AttentionKind,
    text: string | null,
    reply: boolean,
    extra: Partial<AttentionItem> = {},
  ): AttentionItem => ({
    id: `${kind}:${card.id}`,
    kind,
    ...base,
    text,
    reply,
    ...extra,
  });
  if (state === "needs_input") {
    switch (session.stateReason) {
      case "usage_stop":
        return make("usage_stop", null, false);
      case "budget":
        return make("budget_stop", null, false);
      case "resume_failed":
        return make(
          "resume_failed",
          card.statusReason?.replace(/^resume: /, "") ?? null,
          false,
          { lost: card.sessionLost === true },
        );
      default:
        return make("needs_input", card.statusReason ?? null, true);
    }
  }
  if (state === "stale") {
    return make(
      "stale",
      `No progress for ${waitMinutes + STALE_MINUTES} min.`,
      true,
    );
  }
  if (state === "permission_prompt") {
    return make(
      "permission_prompt",
      permissionEvidence(events, session.id) ?? card.statusReason ?? null,
      false,
    );
  }
  return null;
}

function gateItem(card: Card, now: Date): AttentionItem | null {
  if (card.column === "done" || card.loopProgress?.completion === "complete") {
    return null;
  }
  const gate = card.loopProgress?.summary.lastGate;
  if (gate?.result !== "fail") return null;
  const phase = card.loopProgress?.units
    .find((unit) => unit.number === gate.unit)
    ?.phases.find((candidate) => candidate.number === gate.phase);
  return {
    id: `failed_gate:${card.id}`,
    kind: "failed_gate",
    cardId: card.id,
    groupId: card.identifier,
    state: null,
    waitingSince: gate.at,
    waitMinutes: waitMinutesOf(gate.at, now),
    text: null,
    reply: false,
    gate: {
      unit: gate.unit,
      phase: gate.phase,
      attempt: phase?.attempts ?? 1,
      limit: phase?.retryBudget ?? null,
    },
  };
}

/**
 * A Needs Input card that no supervisor state explains, as on a board with the supervisor off.
 *
 * @remarks The boards page counted these cards before the queue existed, so the queue keeps them;
 * the wait starts when the card entered its column, or at its update time when no entry time is set.
 */
function columnItem(
  card: Card,
  session: ActiveSessionView | null,
  now: Date,
): AttentionItem {
  const since = card.columnSince ?? card.updatedAt;
  return {
    id: `needs_input:${card.id}`,
    kind: "needs_input",
    cardId: card.id,
    groupId: card.identifier,
    state: null,
    waitingSince: since,
    waitMinutes: waitMinutesOf(since, now),
    text: card.statusReason ?? null,
    reply: session !== null,
  };
}

function byWait(a: AttentionItem, b: AttentionItem): number {
  return (
    Date.parse(a.waitingSince) - Date.parse(b.waitingSince) ||
    (a.groupId ?? "").localeCompare(b.groupId ?? "", undefined, {
      numeric: true,
    }) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Builds the attention queue of a board: every item that waits for the user, oldest wait first.
 *
 * @remarks Each item reads from the active session, the last gate of a group card or an open
 * decision, so a state that moves on or a later passing gate drops its item with no extra step.
 * A group mirrors its column onto its members, so a member gets no column item of its own.
 */
export function buildAttentionQueue(input: {
  boardKey: BoardKey;
  cards: readonly Card[];
  decisions: readonly DecisionItem[];
  events?: readonly OrchestrationEvent[];
  now: Date;
}): AttentionItem[] {
  const { boardKey, now, events = [] } = input;
  const cards = input.cards.filter(
    (card) => (card.boardKey ?? DEFAULT_BOARD_KEY) === boardKey,
  );
  const memberIds = new Set(cards.flatMap((card) => card.memberIds ?? []));
  const items: AttentionItem[] = [];
  for (const card of cards) {
    const session = activeSessionView(card);
    const fromSession =
      session === null ? null : sessionItem(card, session, events, now);
    if (fromSession !== null) items.push(fromSession);
    else if (card.column === "needs_input" && !memberIds.has(card.id)) {
      items.push(columnItem(card, session, now));
    }
    const fromGate = gateItem(card, now);
    if (fromGate !== null) items.push(fromGate);
  }
  const identifiers = new Map(cards.map((card) => [card.id, card.identifier]));
  for (const decision of input.decisions) {
    if (decision.state !== "open" || decision.boardKey !== boardKey) continue;
    items.push({
      id: `decision:${decision.id}`,
      kind: "decision",
      cardId: decision.cardId,
      groupId:
        decision.cardId === null
          ? null
          : (identifiers.get(decision.cardId) ?? null),
      state: null,
      waitingSince: decision.createdAt,
      waitMinutes: waitMinutesOf(decision.createdAt, now),
      text: decision.question,
      reply: false,
    });
  }
  return items.sort(byWait);
}
