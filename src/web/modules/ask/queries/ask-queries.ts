import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  EMPTY_ASK_STATE,
  askHistory,
  askReducer,
  type AskEvent,
  type AskState,
} from "@/modules/ask/domain/ask-conversation";
import { askQuestion, type AskResult } from "./ask-api.js";

export const askKeys = {
  all: ["ask"] as const,
  conversation: ["ask", "conversation"] as const,
};

export type AskAction =
  | { type: "send"; question: string }
  | { type: "retry" }
  | { type: "cancel" }
  | { type: "clear" };

let controller: AbortController | null = null;

/**
 * Build the options of the conversation cache entry.
 *
 * @remarks
 * The entry never fetches: the server keeps no conversation, so `runAskAction` writes it and it lives until a reload. The query function only returns what the cache holds.
 */
export function askConversationQueryOptions() {
  return queryOptions({
    queryKey: askKeys.conversation,
    queryFn: ({ client }) => readConversation(client),
    initialData: EMPTY_ASK_STATE,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

function readConversation(client: QueryClient): AskState {
  return client.getQueryData<AskState>(askKeys.conversation) ?? EMPTY_ASK_STATE;
}

function dispatch(client: QueryClient, event: AskEvent): void {
  const current = readConversation(client);
  const next = askReducer(current, event);
  if (next !== current) client.setQueryData(askKeys.conversation, next);
}

async function send(client: QueryClient, question: string): Promise<void> {
  const text = question.trim();
  const current = readConversation(client);
  if (text === "" || current.pending !== null) return;
  const history = askHistory(current.turns);
  dispatch(client, { type: "send", question: text });
  const run = new AbortController();
  controller = run;
  let result: AskResult;
  try {
    result = await askQuestion(text, history, run.signal);
  } catch {
    result = { ok: false, error: "failed" };
  }
  if (controller !== run) return;
  controller = null;
  dispatch(
    client,
    result.ok
      ? { type: "answer", answer: result.answer }
      : { type: "fail", error: result.error },
  );
}

function cancel(client: QueryClient): void {
  controller?.abort();
  controller = null;
  dispatch(client, { type: "cancel" });
}

/**
 * Apply one conversation action to the cache entry through the reducer.
 *
 * @remarks
 * A send resolves after the answer or failure is written. Cancel and clear abort the one in-flight request, so its late reply is dropped.
 */
export async function runAskAction(
  client: QueryClient,
  action: AskAction,
): Promise<void> {
  switch (action.type) {
    case "send":
      return send(client, action.question);
    case "cancel":
      return cancel(client);
    case "clear":
      cancel(client);
      return dispatch(client, { type: "clear" });
    case "retry": {
      const current = readConversation(client);
      const last = current.turns.at(-1);
      if (current.error === null || last?.role !== "user") return;
      dispatch(client, { type: "retry" });
      return send(client, last.text);
    }
  }
}

export function useAskQuestionMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: AskAction) => runAskAction(client, action),
  });
}

export function useAskConversationQuery() {
  return useQuery(askConversationQueryOptions());
}
