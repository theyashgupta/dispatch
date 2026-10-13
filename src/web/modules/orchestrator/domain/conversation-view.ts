import {
  decisionView,
  GATE_KINDS,
  type DecisionView,
} from "../../../../shared/decision-view.js";
import type {
  ConversationMessage,
  DecisionItem,
} from "../../../../shared/types.js";

export type ConversationEntry =
  | {
      kind: "message";
      id: string;
      at: string | null;
      author: string;
      text: string;
    }
  | {
      kind: "decision";
      id: string;
      at: string;
      badge: "Decision" | "Question";
      view: DecisionView;
      state: "open" | "answered";
      answerText: string | null;
      answerNote: string | null;
    };

export const ANSWERED_DECISION_CAP = 20;

export interface ConversationViewInput {
  messages: readonly ConversationMessage[];
  decisions: readonly DecisionItem[];
  orchestratorId: string;
  orchestratorName: string;
  orchestratorNames: ReadonlyMap<string, string>;
  now: number;
}

/**
 * Merge the transcript messages, the open decisions and the newest ANSWERED_DECISION_CAP answered decisions of one orchestrator into one timeline.
 *
 * @remarks
 * Messages keep their order. A decision goes before the first message that is later than
 * it, so a message with no time never moves a decision and a tie keeps the message first.
 */
export function conversationView(
  input: ConversationViewInput,
): ConversationEntry[] {
  const authors = {
    user: "You",
    orchestrator: input.orchestratorName,
    system: "Dispatch",
  } as const;
  const own = input.decisions.filter(
    (d) => d.orchestratorId === input.orchestratorId,
  );
  const answered = own.filter((d) => d.state === "answered");
  const answeredIds = new Set(answered.map((d) => d.id));
  const answeredAt = (d: DecisionItem) =>
    Date.parse(d.answeredAt ?? d.createdAt);
  const newestAnswered = [...answered]
    .sort(
      (a, b) =>
        answeredAt(b) - answeredAt(a) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
    .slice(0, ANSWERED_DECISION_CAP);
  const decisions = [
    ...own.filter((d) => d.state === "open" && !answeredIds.has(d.id)),
    ...newestAnswered,
  ]
    .map((item) => {
      const label =
        item.options.find((o) => o.id === item.answer?.optionId)?.label ?? null;
      return {
        time: Date.parse(item.createdAt),
        entry: {
          kind: "decision",
          id: item.id,
          at: item.createdAt,
          badge: GATE_KINDS.includes(item.kind) ? "Decision" : "Question",
          view: decisionView(item, input.orchestratorNames, input.now),
          state: item.state,
          answerText:
            item.state === "answered"
              ? label === null
                ? "Answered"
                : `Answered: ${label}`
              : null,
          answerNote: item.answer?.note ?? null,
        } satisfies ConversationEntry,
      };
    })
    .sort((a, b) => a.time - b.time);
  const entries: ConversationEntry[] = [];
  let next = 0;
  for (const message of input.messages) {
    while (
      next < decisions.length &&
      message.at !== null &&
      Date.parse(message.at) > decisions[next].time
    ) {
      entries.push(decisions[next++].entry);
    }
    entries.push({
      kind: "message",
      id: message.id,
      at: message.at,
      author: authors[message.role],
      text: message.text,
    });
  }
  return [...entries, ...decisions.slice(next).map((d) => d.entry)];
}
