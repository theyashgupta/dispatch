import {
  InboxContainer,
  type InboxContainerProps,
} from "@/modules/inbox/containers/InboxContainer";

const SCOPE_ID = "inbox-view";

export function InboxView(props: Omit<InboxContainerProps, "scopeId">) {
  return (
    <div id={SCOPE_ID} className="flex min-h-0 flex-auto flex-col">
      <InboxContainer {...props} scopeId={SCOPE_ID} />
    </div>
  );
}
