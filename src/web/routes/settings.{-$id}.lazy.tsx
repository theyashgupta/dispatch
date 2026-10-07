import { createLazyFileRoute } from "@tanstack/react-router";
import { ConnectionsView } from "@/modules/connections";
import { SettingsView } from "@/modules/settings";

export const Route = createLazyFileRoute("/settings/{-$id}")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { id } = Route.useParams();
  return <SettingsView tabId={id} connections={<ConnectionsView />} />;
}
