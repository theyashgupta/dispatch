import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import { BootScreen } from "@/components/BootScreen";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import type { AppStore } from "@/lib/app-store";
import { AccountChipView, AccountsHeaderView } from "@/modules/accounts";
import { ActivityFilterView, ActivityListView } from "@/modules/activity";
import { AskHeaderView } from "@/modules/ask";
import {
  CleanupView,
  CreateTicketView,
  GroupStartView,
  ResetView,
  StartView,
  SyncToLinearView,
} from "@/modules/card-actions";
import { SetupConnectionsView } from "@/modules/connections";
import { DetailPanelView } from "@/modules/detail";
import { setupQueryOptions, SetupWizardView } from "@/modules/setup";
import { ShellView } from "@/modules/shell";
import {
  boardSnapshotKeys,
  boardSnapshotQueryOptions,
  shouldPrefetchBoard,
} from "@/queries/board-snapshot-queries";
import { DONE_PAGE_SIZE } from "../../shared/done-limit.js";
import { notFoundTarget, type Page } from "../../shared/route.js";

const MeetingNotesView = lazy(() =>
  import("@/modules/meetings").then((m) => ({ default: m.MeetingNotesView })),
);

const PAGE_HEADER_VIEWS: Partial<Record<Page, ComponentType>> = {
  accounts: AccountsHeaderView,
  activity: ActivityFilterView,
  archive: lazy(() =>
    import("@/modules/archive").then((m) => ({ default: m.ArchiveHeaderView })),
  ),
  ask: AskHeaderView,
  meetings: lazy(() =>
    import("@/modules/meetings").then((m) => ({
      default: m.MeetingsHeaderView,
    })),
  ),
  playbooks: lazy(() =>
    import("@/modules/playbooks").then((m) => ({
      default: m.PlaybooksHeaderView,
    })),
  ),
  vault: lazy(() =>
    import("@/modules/vault").then((m) => ({ default: m.VaultHeaderView })),
  ),
  workspaces: lazy(() =>
    import("@/modules/workspaces").then((m) => ({
      default: m.WorkspacesHeaderView,
    })),
  ),
};

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  appStore: AppStore;
}>()({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: async ({ context }) => {
    const { queryClient } = context;
    if (
      shouldPrefetchBoard(
        queryClient
          .getQueryCache()
          .findAll({ queryKey: boardSnapshotKeys.all }),
      )
    ) {
      void queryClient
        .ensureQueryData(boardSnapshotQueryOptions(DONE_PAGE_SIZE))
        .catch(() => undefined);
    }
    const setupOptions = setupQueryOptions();
    if (queryClient.getQueryState(setupOptions.queryKey)?.status === "error") {
      return { setup: null };
    }
    try {
      return {
        setup: await queryClient.ensureQueryData({
          ...setupOptions,
          staleTime: Infinity,
          gcTime: Infinity,
        }),
      };
    } catch (err) {
      console.error("getSetup failed", err);
      return { setup: null };
    }
  },
  pendingComponent: () => <BootScreen connection="connecting" />,
  component: RootComponent,
  notFoundComponent: RootNotFound,
});

function RootComponent() {
  const { appStore } = Route.useRouteContext();
  const meetingNotesOpen = useAppStore(appStore, (s) => s.meetingNotesOpen);
  return (
    <ShellView
      headerViews={PAGE_HEADER_VIEWS}
      accountSlot={<AccountChipView />}
      activityList={<ActivityListView />}
      content={<Outlet />}
      detail={<DetailPanelView />}
    >
      <StartView />
      <GroupStartView />
      <CleanupView />
      <ResetView />
      <SyncToLinearView />
      <CreateTicketView />
      {meetingNotesOpen && (
        <Suspense fallback={null}>
          <MeetingNotesView />
        </Suspense>
      )}
      <SetupWizardView connections={<SetupConnectionsView />} />
    </ShellView>
  );
}

function RootNotFound() {
  const router = useRouter();
  const [target] = useState(() =>
    notFoundTarget(router.state.location.pathname),
  );
  useEffect(() => {
    void router.navigate({ href: target, replace: true });
  }, [router, target]);
  return null;
}
