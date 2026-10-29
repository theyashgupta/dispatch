import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import type { Page } from "../../../../shared/route.js";
import { Button } from "@/components/ui/button";
import {
  SidebarFooter,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavRow } from "@/modules/shell/components/NavRow";
import { SyncStatus } from "@/modules/shell/components/SyncStatus";
import type { SyncSnapshot } from "@/modules/shell/domain/sync-status";

const FOOTER_BUTTON_CLASS = "text-muted-foreground hover:text-muted-foreground";

interface SidebarFooterActionsProps {
  current: Page;
  sync: SyncSnapshot;
  accountSlot?: ReactNode;
  collapsed: boolean;
  canToggle: boolean;
  onNavigate: (page: Page) => void;
  onOpenCreateTicket: () => void;
}

export function SidebarFooterActions({
  current,
  sync,
  accountSlot,
  collapsed,
  canToggle,
  onNavigate,
  onOpenCreateTicket,
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
      {collapsed || !canToggle ? null : (
        <div className="flex min-w-0 items-center justify-end gap-1">
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
        </div>
      )}
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
