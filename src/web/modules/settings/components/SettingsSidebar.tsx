import { NAV_ITEMS } from "../../../../shared/nav-items.js";
import type { Page } from "../../../../shared/route.js";
import {
  Archive,
  Bell,
  ClipboardList,
  Columns3,
  Download,
  FolderGit2,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  Palette,
  Plug,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SettingsTab } from "@/modules/settings/domain/settings-tab";

const PAGE_LINKS = NAV_ITEMS.filter((item) => item.group === "System");

export const SETTINGS_SECTIONS: {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "connections", label: "Connections", icon: Plug },
  { id: "board", label: "Board", icon: Columns3 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "remote", label: "Remote access", icon: Globe },
  { id: "workspaces", label: "Workspaces", icon: FolderGit2 },
  { id: "about-you", label: "About you", icon: UserRound },
  { id: "updates", label: "Updates", icon: Download },
  { id: "about", label: "About", icon: Info },
];

const PAGE_ICON: Partial<Record<Page, LucideIcon>> = {
  accounts: Users,
  playbooks: ClipboardList,
  vault: KeyRound,
  archive: Archive,
  workspaces: HardDrive,
  flow: Workflow,
};

interface SettingsSidebarProps {
  onOpenPage: (page: Page) => void;
}

export function SettingsSidebar({ onOpenPage }: SettingsSidebarProps) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex w-(--orca-nav-width) max-w-[80vw] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-sidebar p-4"
    >
      <TabsList className="h-auto w-full gap-0.5 bg-transparent p-0">
        {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
          <TabsTrigger
            key={id}
            value={id}
            className="h-auto flex-none p-2 data-[state=active]:bg-card"
          >
            <Icon aria-hidden="true" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex flex-col gap-0.5">
        <div className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Pages
        </div>
        {PAGE_LINKS.map(({ page, label }) => {
          const Icon = PAGE_ICON[page];
          return (
            <Button
              key={page}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start p-2 text-sm font-semibold text-muted-foreground"
              onClick={() => onOpenPage(page)}
            >
              {Icon && <Icon aria-hidden="true" />}
              {label}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
