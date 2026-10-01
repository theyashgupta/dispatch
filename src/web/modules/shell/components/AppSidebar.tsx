import type { ReactNode } from "react";
import type { Page } from "../../../../shared/route.js";
import { Glyph } from "@/components/icons/Glyph";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { NavRow } from "@/modules/shell/components/NavRow";
import { SidebarFooterActions } from "@/modules/shell/components/SidebarFooterActions";
import {
  navGroups,
  type NavCounts,
  type NavItem,
} from "@/modules/shell/domain/nav-items";
import type { SyncSnapshot } from "@/modules/shell/domain/sync-status";

export interface AppSidebarProps {
  current: Page;
  navItems: readonly NavItem[];
  counts: NavCounts;
  sync: SyncSnapshot;
  accountSlot?: ReactNode;
  activityUnseen: boolean;
  activityOpen: boolean;
  carousel: boolean;
  onNavigate: (page: Page) => void;
  onOpenCreateTicket: () => void;
  onOpenActivity: () => void;
}

export function AppSidebar({
  current,
  navItems,
  counts,
  sync,
  accountSlot,
  activityUnseen,
  activityOpen,
  carousel,
  onNavigate,
  onOpenCreateTicket,
  onOpenActivity,
}: AppSidebarProps) {
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const canToggle = !isMobile && !carousel;

  return (
    <Sidebar collapsible="icon" className="z-11">
      <nav
        aria-label="Primary"
        className="flex h-full min-h-0 flex-col select-none"
      >
        <SidebarHeader
          className={cn(
            "h-(--page-header-height) shrink-0 flex-row items-center gap-1 border-b border-border p-0 px-4 text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <Glyph size={16} title={collapsed ? "Dispatch" : undefined} />
          {collapsed ? null : (
            <span className="text-(length:--font-display) font-semibold tracking-[0.18em]">
              DISPATCH
            </span>
          )}
        </SidebarHeader>

        <SidebarContent className="gap-0 overflow-x-hidden p-2 group-data-[collapsible=icon]:overflow-y-auto">
          {navGroups(navItems).map((entry, index) => (
            <SidebarGroup key={entry.group} className="p-0">
              {collapsed ? (
                index > 0 ? (
                  <SidebarSeparator className="mx-1 my-2 bg-border data-[orientation=horizontal]:w-auto" />
                ) : null
              ) : (
                <SidebarGroupLabel className="h-auto rounded-none pt-2 pb-1 font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                  {entry.group}
                </SidebarGroupLabel>
              )}
              <SidebarMenu className="gap-0">
                {entry.items.map((item) => (
                  <NavRow
                    key={item.page}
                    page={item.page}
                    label={item.label}
                    brand={item.brand}
                    active={current === item.page}
                    collapsed={collapsed}
                    live={
                      item.page === "sessions" && (counts.sessions ?? 0) > 0
                    }
                    count={counts[item.page]}
                    neutral={item.page === "tickets"}
                    onNavigate={onNavigate}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooterActions
          current={current}
          sync={sync}
          accountSlot={accountSlot}
          collapsed={collapsed}
          canToggle={canToggle}
          activityUnseen={activityUnseen}
          activityOpen={activityOpen}
          onNavigate={onNavigate}
          onOpenCreateTicket={onOpenCreateTicket}
          onOpenActivity={onOpenActivity}
        />
      </nav>
    </Sidebar>
  );
}
