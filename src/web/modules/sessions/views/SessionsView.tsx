import { SessionsContainer } from "@/modules/sessions/containers/SessionsContainer";

const SCOPE_ID = "sessions-page";

export function SessionsView() {
  return (
    <div id={SCOPE_ID} className="flex min-h-0 flex-auto flex-col">
      <SessionsContainer scopeId={SCOPE_ID} />
    </div>
  );
}
