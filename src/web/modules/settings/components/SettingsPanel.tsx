import type { ReactNode } from "react";
import { TabsContent } from "@/components/ui/tabs";
import type { SettingsTab } from "@/modules/settings/domain/settings-tab";

interface SettingsPanelProps {
  tab: SettingsTab;
  children: ReactNode;
}

export function SettingsPanel({ tab, children }: SettingsPanelProps) {
  return (
    <TabsContent
      value={tab}
      forceMount
      className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
    >
      {children}
    </TabsContent>
  );
}
