import { createLazyFileRoute } from "@tanstack/react-router";
import { ConnectionsView } from "@/modules/connections";
import { SettingsView } from "@/modules/settings";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/settings/{-$id}")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const props = useAppState().settings;
  const { id } = Route.useParams();
  return (
    <SettingsView
      {...props}
      tabId={id}
      connections={
        <ConnectionsView
          onRunSetup={props.onRunSetup}
          connectionKey={props.connectionKey}
          errorsInFeeds={props.errorsInFeeds}
          onToggleErrorsInFeeds={props.onToggleErrorsInFeeds}
          onSaved={props.onSaved}
        />
      }
    />
  );
}
