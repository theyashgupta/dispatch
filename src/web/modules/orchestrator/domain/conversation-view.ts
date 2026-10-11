import {
  decisionView,
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
      badge: "Decision" | "Question";
      view: DecisionView;
      state: "open" | "answered";
      answerLabel: string | null;
    };

export interface ConversationViewInput {
  messages: readonly ConversationMessage[];
  decisions: readonly DecisionItem[];
  orchestratorId: string;
  orchestratorName: string;
  orchestratorNames: ReadonlyMap<string, string>;
  now: number;
}

const GATE_BADGE_KINDS: readonly DecisionItem["kind"][] = [
  "plan",
  "roadmap_approval",
  "ticket_proposal",
];

/**
 * Merges the transcript messages and the decision items of one orchestrator into one timeline.
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
  const decisions = input.decisions
    .filter((d) => d.orchestratorId === input.orchestratorId)
    .map((item) => ({
      time: Date.parse(item.createdAt),
      entry: {
        kind: "decision",
        id: item.id,
        at: item.createdAt,
        badge: GATE_BADGE_KINDS.includes(item.kind) ? "Decision" : "Question",
        view: decisionView(item, input.orchestratorNames, input.now),
        state: item.state,
        answerLabel:
          item.state === "answered"
            ? (item.options.find((o) => o.id === item.answer?.optionId)
                ?.label ?? null)
            : null,
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
