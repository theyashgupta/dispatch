import type { ReactNode } from "react";
import type { Page } from "../../../../shared/route.js";
import { Tabs } from "@/components/ui/tabs";
import { useIsMobile } from "@/components/ui/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { SettingsSectionSelect } from "@/modules/settings/components/SettingsSectionSelect";
import {
  SETTINGS_SECTIONS,
  SettingsSidebar,
} from "@/modules/settings/components/SettingsSidebar";
import {
  settingsTabFrom,
  type SettingsTab,
} from "@/modules/settings/domain/settings-tab";

export interface SettingsFrameProps {
  tabId: string | undefined;
  onTabChange: (tab: SettingsTab) => void;
  onOpenPage: (page: Page) => void;
  children: ReactNode;
}

export function SettingsFrame({
  tabId,
  onTabChange,
  onOpenPage,
  children,
}: SettingsFrameProps) {
  const tab = settingsTabFrom(tabId);
  const mobile = useIsMobile();
  const active =
    SETTINGS_SECTIONS.find((section) => section.id === tab) ??
    SETTINGS_SECTIONS[0];

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(settingsTabFrom(value))}
      orientation="vertical"
      className={cn(
        "min-h-0 flex-1 gap-0 bg-background",
        mobile ? "flex-col" : "flex-row",
      )}
    >
      {mobile ? (
        <SettingsSectionSelect
          tab={tab}
          onTabChange={(value) => onTabChange(settingsTabFrom(value))}
        />
      ) : (
        <SettingsSidebar onOpenPage={onOpenPage} />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border px-8 pt-6 pb-4">
          <h1 className="m-0 font-sans text-(length:--font-display) font-semibold text-foreground">
            {active.label}
          </h1>
        </header>
        {children}
      </div>
    </Tabs>
  );
}
