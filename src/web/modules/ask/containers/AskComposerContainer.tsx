import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { routeHash } from "../../../../shared/route.js";
import { AskComposer } from "@/modules/ask/components/AskComposer";
import {
  useAskConversationQuery,
  useAskQuestionMutation,
} from "@/modules/ask/queries/ask-queries";

export interface AskComposerContainerProps {
  prefill?: string;
}

export function AskComposerContainer({ prefill }: AskComposerContainerProps) {
  const router = useRouter();
  const onPrefillConsumed = useCallback(
    () =>
      void router.navigate({
        href: routeHash({ page: "ask" }).slice(1),
        replace: true,
      }),
    [router],
  );
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
