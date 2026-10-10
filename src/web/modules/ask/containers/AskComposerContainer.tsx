import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { routeHash } from "../../../../shared/route.js";
import { AskComposer } from "@/modules/ask/components/AskComposer";
import {
  CANCELLED,
  type BoardIntent,
  NAME_QUESTION,
  createdAnswer,
  refusedAnswer,
  resolveBoardIntent,
} from "@/modules/ask/domain/ask-intent";
import {
  useAskConversationQuery,
  useAskQuestionMutation,
} from "@/modules/ask/queries/ask-queries";
import { useCreateBoardMutation } from "@/queries/board-create-queries";

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
  const { mutateAsync } = useAskQuestionMutation();
  const createBoard = useCreateBoardMutation();
  const [draft, setDraft] = useState(prefill ?? "");
  const [lastPrefill, setLastPrefill] = useState(prefill);
  if (prefill !== lastPrefill) {
    setLastPrefill(prefill);
    if (prefill !== undefined) setDraft(prefill);
  }

  useEffect(() => {
    if (prefill !== undefined) onPrefillConsumed();
  }, [prefill, onPrefillConsumed]);

  const handleBoardIntent = async (intent: BoardIntent, text: string) => {
    const { generation } = data;
    const say = (role: "user" | "assistant", line: string) =>
      mutateAsync({ type: "local", turn: { role, text: line }, generation });
    await say("user", text);
    if (intent.kind === "needs-name") {
      await say("assistant", NAME_QUESTION);
      await mutateAsync({ type: "await-board-name" });
      return;
    }
    await mutateAsync({ type: "board-name-done" });
    if (intent.kind === "cancel") {
      await say("assistant", CANCELLED);
      return;
    }
    const result = await createBoard.mutateAsync({ name: intent.name });
    await say(
      "assistant",
      result.ok
        ? createdAnswer(result.board.name, result.board.key)
        : refusedAnswer(result.error),
    );
  };

  return (
    <AskComposer
      value={draft}
      onChange={setDraft}
      onSend={() => {
        const text = draft.trim();
        const intent = resolveBoardIntent(text, data.pendingBoardName);
        if (intent === null) {
          void mutateAsync({ type: "send", question: text });
        } else {
          void handleBoardIntent(intent, text);
        }
        setDraft("");
      }}
      pending={data.pending !== null || createBoard.isPending}
    />
  );
}
