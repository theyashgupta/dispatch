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
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/utils";
import { NavRow } from "@/modules/shell/components/NavRow";
import {
  SidebarBoards,
  type SidebarBoardsData,
} from "@/modules/shell/components/SidebarBoards";
import {
  SidebarDashboards,
  type SidebarDashboardsData,
} from "./SidebarDashboards";
import { SidebarFooterActions } from "@/modules/shell/components/SidebarFooterActions";
import {
  navGroups,
  type NavCounts,
  type NavItem,
} from "../../../../shared/nav-items.js";
import type { SyncSnapshot } from "@/modules/shell/domain/sync-status";

export interface AppSidebarProps {
  current: Page;
  navItems: readonly NavItem[];
  counts: NavCounts;
  sync: SyncSnapshot;
  accountSlot?: ReactNode;
  carousel: boolean;
  boards: SidebarBoardsData;
  dashboards: SidebarDashboardsData;
  hasMainOrchestrator: boolean;
  onNavigate: (page: Page) => void;
  onOpenCreateTicket: () => void;
}

export function AppSidebar({
  current,
  navItems,
  counts,
  sync,
  accountSlot,
  carousel,
  boards,
  dashboards,
  hasMainOrchestrator,
  onNavigate,
  onOpenCreateTicket,
}: AppSidebarProps) {
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const canToggle = !isMobile && !carousel;
  const brand = (
    <>
      <Glyph size={16} title={collapsed ? "Dispatch" : undefined} />
      {collapsed ? null : <Wordmark />}
    </>
  );

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
          {brand}
        </SidebarHeader>

        <SidebarContent className="gap-0 overflow-x-hidden p-2 group-data-[collapsible=icon]:overflow-y-auto">
          {navGroups(navItems).map((entry, index) => (
            <SidebarGroup key={entry.group} className="p-0">
              {collapsed ? (
                index > 0 ? (
                  <SidebarSeparator className="mx-1 my-2 bg-border data-[orientation=horizontal]:w-auto" />
                ) : null
              ) : (
                <SidebarGroupLabel className="h-auto rounded-none pt-2 pb-1 font-semibold tracking-(--tracking-label) text-muted-foreground uppercase">
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
                    count={counts[item.page]}
                    neutral={item.page === "tickets"}
                    onNavigate={onNavigate}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
          {collapsed ? (
            <>
              <SidebarSeparator className="mx-1 my-2 bg-border data-[orientation=horizontal]:w-auto" />
              <SidebarGroup className="p-0">
                <SidebarMenu className="gap-0">
                  <NavRow
                    page="boards"
                    label="Boards"
                    active={current === "boards"}
                    collapsed
                    onNavigate={onNavigate}
                  />
                  {hasMainOrchestrator ? (
                    <NavRow
                      page="dashboard"
                      label="Dashboards"
                      active={current === "dashboard"}
                      collapsed
                      onNavigate={onNavigate}
                    />
                  ) : null}
                </SidebarMenu>
              </SidebarGroup>
            </>
          ) : (
            <>
              <SidebarBoards {...boards} />
              <SidebarDashboards {...dashboards} />
            </>
          )}
        </SidebarContent>

        <SidebarFooterActions
          current={current}
          sync={sync}
          accountSlot={accountSlot}
          collapsed={collapsed}
          canToggle={canToggle}
          onNavigate={onNavigate}
          onOpenCreateTicket={onOpenCreateTicket}
        />
      </nav>
    </Sidebar>
  );
}
