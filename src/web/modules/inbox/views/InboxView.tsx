import type { ReactNode } from "react";
import type { SlackThreadSlotArgs } from "@/modules/inbox/components/InboxRow";
import { InboxContainer } from "@/modules/inbox/containers/InboxContainer";

const SCOPE_ID = "inbox-view";

interface InboxViewProps {
  renderSlackThread?: (args: SlackThreadSlotArgs) => ReactNode;
}

export function InboxView({ renderSlackThread }: InboxViewProps) {
  return (
    <div id={SCOPE_ID} className="flex min-h-0 flex-auto flex-col">
      <InboxContainer
        scopeId={SCOPE_ID}
        renderSlackThread={renderSlackThread}
      />
    </div>
  );
}
