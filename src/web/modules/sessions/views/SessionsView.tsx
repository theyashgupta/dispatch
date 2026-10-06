import {
  SessionsContainer,
  type SessionsContainerProps,
} from "@/modules/sessions/containers/SessionsContainer";

const SCOPE_ID = "sessions-page";

export function SessionsView(props: Omit<SessionsContainerProps, "scopeId">) {
  return (
    <div id={SCOPE_ID} className="flex min-h-0 flex-auto flex-col">
      <SessionsContainer {...props} scopeId={SCOPE_ID} />
    </div>
  );
}
