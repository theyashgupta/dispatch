import type { ReactNode } from "react";
import { SettingsContainer } from "@/modules/settings/containers/SettingsContainer";

interface SettingsViewProps {
  tabId: string | undefined;
  connections: ReactNode;
}

export function SettingsView({ tabId, connections }: SettingsViewProps) {
  return <SettingsContainer tabId={tabId} connections={connections} />;
}
