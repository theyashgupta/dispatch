import { PageHeaderActions } from "@/components/PageHeaderActions";
import { PageHeaderCount } from "@/components/PageHeaderCount";
import { AskClearButton } from "@/modules/ask/components/AskClearButton";
import {
  useAskConversationQuery,
  useAskQuestionMutation,
} from "@/modules/ask/queries/ask-queries";

export function AskHeaderContainer() {
  const { data } = useAskConversationQuery();
  const { mutate } = useAskQuestionMutation();
  return (
    <>
      <PageHeaderCount count={data.turns.length} />
      <PageHeaderActions>
        <AskClearButton
          disabled={data.turns.length === 0 && data.pending === null}
          onClear={() => mutate({ type: "clear" })}
        />
      </PageHeaderActions>
    </>
  );
}
