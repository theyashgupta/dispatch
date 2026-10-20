import { useEffect, useState, type ReactNode } from "react";
import type { Page, Route } from "../../../../shared/route.js";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/modules/shell/components/AppSidebar";
import type { SidebarBoardsData } from "./SidebarBoards";
import { BottomBar } from "@/modules/shell/components/BottomBar";
import { PageHeader } from "@/modules/shell/components/PageHeader";
import { TopBar } from "@/modules/shell/components/TopBar";
import type { NavCounts, NavItem } from "../../../../shared/nav-items.js";
import type { SyncSnapshot } from "@/modules/shell/domain/sync-status";
import { useBarVisible } from "@/modules/shell/hooks/use-bar-visible";
import { useChromeTop } from "@/modules/shell/hooks/use-chrome-top";
import { useMenuFocusReturn } from "@/modules/shell/hooks/use-menu-focus-return";

interface ShellFrameProps {
  route: Route;
  onNavigate: (page: Page) => void;
  navItems: readonly NavItem[];
  counts: NavCounts;
  sync: SyncSnapshot;
  accountSlot?: ReactNode;
  onOpenCreateTicket: () => void;
  onOpenActivity: () => void;
  activityUnseen: boolean;
  activityOpen: boolean;
  carousel: boolean;
  boards: SidebarBoardsData;
  pageTitle: string;
  pageCount?: number;
  headerView?: ReactNode;
  banner: ReactNode;
  content: ReactNode;
  detail: ReactNode;
  children?: ReactNode;
  onMobileOpenChange?: (open: boolean) => void;
  needsYouCount: number;
}

export function ShellFrame({
  route,
  onNavigate,
  navItems,
  counts,
  sync,
  accountSlot,
  activityUnseen,
  activityOpen,
  carousel,
  boards,
  pageTitle,
  pageCount,
  headerView,
  banner,
  content,
  detail,
  children,
  onMobileOpenChange,
  onOpenCreateTicket,
  onOpenActivity,
  needsYouCount,
}: ShellFrameProps) {
  const { isMobile, openMobile, setOpenMobile, state } = useSidebar();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [chrome, setChrome] = useState<HTMLDivElement | null>(null);
  useChromeTop(chrome, root);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const barHidden = !useBarVisible(column, route.page);
  const phoneSheetOpen = isMobile && openMobile;
  const skipFocusReturn = useMenuFocusReturn(phoneSheetOpen);

  useEffect(() => {
    if (!isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  useEffect(() => {
    onMobileOpenChange?.(phoneSheetOpen);
  }, [phoneSheetOpen, onMobileOpenChange]);

  return (
    <div
      ref={setRoot}
      className={cn(
        "contents",
        isMobile
          ? "[--nav-current:0px]"
          : state === "collapsed"
            ? "[--nav-current:var(--nav-width-collapsed)]"
            : "[--nav-current:var(--nav-width)]",
      )}
    >
      <AppSidebar
        current={route.page}
        navItems={navItems}
        counts={counts}
        sync={sync}
        accountSlot={accountSlot}
        activityUnseen={activityUnseen}
        activityOpen={activityOpen}
        carousel={carousel}
        boards={{
          ...boards,
          onOpenBoard: (key) => {
            boards.onOpenBoard(key);
            setOpenMobile(false);
          },
          onCreate: () => {
            boards.onCreate();
            setOpenMobile(false);
          },
        }}
        onNavigate={(page) => {
          onNavigate(page);
          setOpenMobile(false);
        }}
        onOpenCreateTicket={() => {
          onOpenCreateTicket();
          skipFocusReturn();
          setOpenMobile(false);
        }}
        onOpenActivity={() => {
          onOpenActivity();
          skipFocusReturn();
          setOpenMobile(false);
        }}
      />
      <div
        ref={setColumn}
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        inert={phoneSheetOpen}
      >
        <div ref={setChrome} className="shrink-0">
          {isMobile ? <TopBar title={pageTitle} /> : null}
          {banner}
          <PageHeader title={pageTitle} count={pageCount}>
            {headerView}
          </PageHeader>
        </div>
        {content}
        {isMobile ? (
          <BottomBar
            current={route.page}
            onNavigate={onNavigate}
            onOpenCreateTicket={onOpenCreateTicket}
            hidden={barHidden}
            needsCount={needsYouCount}
          />
        ) : null}
      </div>
      <div className="contents" inert={phoneSheetOpen}>
        {detail}
      </div>
      {children}
    </div>
  );
}
