import type { ReactNode } from "react";
import { Activity, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import type { Page } from "../../../../shared/route.js";
import { Button } from "@/components/ui/button";
import {
  SidebarFooter,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { NavRow } from "@/modules/shell/components/NavRow";
import { SyncStatus } from "@/modules/shell/components/SyncStatus";
import { SHELL_IDS } from "@/modules/shell/domain/shell-ids";
import type { SyncSnapshot } from "@/modules/shell/domain/sync-status";

const FOOTER_BUTTON_CLASS = "text-muted-foreground hover:text-muted-foreground";

interface SidebarFooterActionsProps {
  current: Page;
  sync: SyncSnapshot;
  accountSlot?: ReactNode;
  collapsed: boolean;
  canToggle: boolean;
  activityUnseen: boolean;
  activityOpen: boolean;
  onNavigate: (page: Page) => void;
  onOpenCreateTicket: () => void;
  onOpenActivity: () => void;
}

export function SidebarFooterActions({
  current,
  sync,
  accountSlot,
  collapsed,
  canToggle,
  activityUnseen,
  activityOpen,
  onNavigate,
  onOpenCreateTicket,
  onOpenActivity,
}: SidebarFooterActionsProps) {
  const { toggleSidebar } = useSidebar();
  return (
    <SidebarFooter className="gap-1 border-t border-border p-2">
      <SyncStatus sync={sync} collapsed={collapsed} />
      {accountSlot}
      <Button
        variant="outline"
        size="sm"
        aria-label="New ticket"
        title="New ticket"
        className="h-7 w-full gap-1 bg-(--surface-card) text-sm font-semibold text-foreground shadow-none hover:bg-(--surface-card-hover) dark:border-border dark:bg-(--surface-card) dark:hover:bg-(--surface-card-hover)"
        onClick={onOpenCreateTicket}
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        {collapsed ? null : <span>New ticket</span>}
      </Button>
      <div
        className={cn(
          "flex min-w-0 items-center gap-1",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        <div className="relative flex">
          <Button
            id={SHELL_IDS.activityToggle}
            variant="ghost"
            size="icon-md"
            aria-label="Activity feed"
            title={activityUnseen ? "Activity: unseen" : "Activity"}
            aria-expanded={activityOpen}
            aria-controls={activityOpen ? SHELL_IDS.activityDrawer : undefined}
            className={FOOTER_BUTTON_CLASS}
            onClick={onOpenActivity}
          >
            <Activity size={16} />
          </Button>
          {activityUnseen && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-(--status-ok)"
            />
          )}
        </div>
        {collapsed || !canToggle ? null : (
          <Button
            variant="ghost"
            size="icon-md"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className={FOOTER_BUTTON_CLASS}
            onClick={toggleSidebar}
          >
            <PanelLeftClose size={16} />
          </Button>
        )}
      </div>
      <SidebarMenu className="gap-0">
        <NavRow
          page="settings"
          label="Settings"
          active={current === "settings"}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </SidebarMenu>
      {collapsed && canToggle ? (
        <div className="flex min-w-0 items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon-md"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className={FOOTER_BUTTON_CLASS}
            onClick={toggleSidebar}
          >
            <PanelLeftOpen size={16} />
          </Button>
        </div>
      ) : null}
    </SidebarFooter>
  );
}
