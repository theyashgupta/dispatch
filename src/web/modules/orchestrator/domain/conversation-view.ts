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
      role: ConversationMessage["role"];
      author: string;
      text: string;
    }
  | {
      kind: "decision";
      id: string;
      at: string;
      decisionKind: DecisionItem["kind"];
      badge: "Decision" | "Question";
      view: DecisionView;
      state: "open" | "answered";
      answerLabel: string | null;
      answerNote: string | null;
    };

export const ANSWERED_DECISION_CAP = 20;

function answeredSortKey(item: DecisionItem): [number, number] {
  return [
    Date.parse(item.answeredAt ?? item.createdAt),
    Date.parse(item.createdAt),
  ];
}

function newestAnswered(items: readonly DecisionItem[]): DecisionItem[] {
  return items
    .filter((d) => d.state === "answered")
    .sort((a, b) => {
      const [aAt, aCreated] = answeredSortKey(a);
      const [bAt, bCreated] = answeredSortKey(b);
      return bAt - aAt || bCreated - aCreated;
    })
    .slice(0, ANSWERED_DECISION_CAP);
}

export interface ConversationViewInput {
  messages: readonly ConversationMessage[];
  decisions: readonly DecisionItem[];
  orchestratorId: string;
  orchestratorName: string;
  orchestratorNames: ReadonlyMap<string, string>;
  now: number;
}

/**
 * Merge the transcript messages and the decision items of one orchestrator into one timeline.
 *
 * @remarks
 * Messages keep their order. A decision goes before the first message that is later than
 * it, so a message with no time never moves a decision and a tie keeps the message first. Every open decision stays, and only the newest 20 answered decisions do; an item in both lists counts as answered.
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
  const answeredIds = new Set(
    own.filter((d) => d.state === "answered").map((d) => d.id),
  );
  const decisions = [
    ...own.filter((d) => d.state === "open" && !answeredIds.has(d.id)),
    ...newestAnswered(own),
  ]
    .map((item) => ({
      time: Date.parse(item.createdAt),
      entry: {
        kind: "decision",
        id: item.id,
        at: item.createdAt,
        decisionKind: item.kind,
        badge: GATE_KINDS.includes(item.kind) ? "Decision" : "Question",
        view: decisionView(item, input.orchestratorNames, input.now),
        state: item.state,
        answerLabel:
          item.state === "answered"
            ? (item.options.find((o) => o.id === item.answer?.optionId)
                ?.label ?? null)
            : null,
        answerNote: item.answer?.note ?? null,
      } satisfies ConversationEntry,
    }))
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
      role: message.role,
      author: authors[message.role],
      text: message.text,
    });
  }
  return [...entries, ...decisions.slice(next).map((d) => d.entry)];
}
