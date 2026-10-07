import { PageBody } from "@/components/PageBody";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AskComposerContainer,
  type AskComposerContainerProps,
} from "@/modules/ask/containers/AskComposerContainer";
import { AskConversationContainer } from "@/modules/ask/containers/AskConversationContainer";

export function AskView(props: AskComposerContainerProps) {
  return (
    <div className="flex min-h-0 flex-auto flex-col">
      <PageBody>
        <AskConversationContainer />
      </PageBody>
      <div className="flex-none border-t border-border">
        <div className="mx-auto flex max-w-180 flex-col gap-(--space-sm) px-(--space-lg) pt-(--space-sm) pb-(--space-lg)">
          <Alert variant="muted" className="gap-y-1 border-0">
            <AlertTitle className="tracking-normal">Privacy</AlertTitle>
            <AlertDescription className="[word-break:break-word] whitespace-pre-wrap">
              Titles and snippets from your board are sent to the Claude CLI to
              answer.
            </AlertDescription>
          </Alert>
          <AskComposerContainer {...props} />
        </div>
      </div>
    </div>
  );
}
