import { createLazyFileRoute } from "@tanstack/react-router";
import { settingsTabFrom } from "@/lib/settings-tab";
import { SettingsScreen } from "@/features/settings";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/settings/{-$id}")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const props = useAppState().settings;
  const { id } = Route.useParams();
  return <SettingsScreen {...props} tab={settingsTabFrom(id)} />;
}
