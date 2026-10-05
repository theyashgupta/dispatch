import { useEffect, useState } from "react";
import { AskComposer } from "@/modules/ask/components/AskComposer";
import {
  useAskConversationQuery,
  useAskQuestionMutation,
} from "@/modules/ask/queries/ask-queries";

export interface AskComposerContainerProps {
  prefill?: string;
  onPrefillConsumed: () => void;
}

export function AskComposerContainer({
  prefill,
  onPrefillConsumed,
}: AskComposerContainerProps) {
  const { data } = useAskConversationQuery();
  const { mutate } = useAskQuestionMutation();
  const [draft, setDraft] = useState(prefill ?? "");
  const [lastPrefill, setLastPrefill] = useState(prefill);
  if (prefill !== lastPrefill) {
    setLastPrefill(prefill);
    if (prefill !== undefined) setDraft(prefill);
  }

  useEffect(() => {
    if (prefill !== undefined) onPrefillConsumed();
  }, [prefill, onPrefillConsumed]);

  return (
    <AskComposer
      value={draft}
      onChange={setDraft}
      onSend={() => {
        mutate({ type: "send", question: draft });
        setDraft("");
      }}
      pending={data.pending !== null}
    />
  );
}
