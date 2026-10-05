import { useEffect, useRef } from "react";
import { AskConversation } from "@/modules/ask/components/AskConversation";
import { AskSuggestions } from "@/modules/ask/components/AskSuggestions";
import {
  useAskConversationQuery,
  useAskQuestionMutation,
} from "@/modules/ask/queries/ask-queries";

export function AskConversationContainer() {
  const { data } = useAskConversationQuery();
  const { mutate } = useAskQuestionMutation();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [data.turns.length, data.pending, data.error]);

  const empty = data.turns.length === 0 && data.pending === null;

  return (
    <>
      {empty ? (
        <AskSuggestions
          onPick={(question) => mutate({ type: "send", question })}
        />
      ) : (
        <AskConversation
          turns={data.turns}
          pending={data.pending}
          error={data.error}
          onCancel={() => mutate({ type: "cancel" })}
          onRetry={() => mutate({ type: "retry" })}
        />
      )}
      <div ref={endRef} />
    </>
  );
}
