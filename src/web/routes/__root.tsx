import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  retainSearchParams,
  useRouter,
} from "@tanstack/react-router";
import { toast } from "sonner";
import { BootScreen } from "@/components/BootScreen";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import type { AppStore } from "@/lib/app-store";
import type { BoardKey } from "../../shared/types.js";
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
import { withTimeout } from "@/lib/with-timeout";
import { boardListQueryOptions } from "@/queries/board-list-queries";
import {
  boardSnapshotKeys,
  boardSnapshotQueryOptions,
  shouldPrefetchBoard,
} from "@/queries/board-snapshot-queries";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import { DONE_PAGE_SIZE } from "../../shared/done-limit.js";
import {
  entryBoard,
  selectBoard,
  unavailableBoardMessage,
} from "../../shared/board-select.js";
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
  boards: lazy(() =>
    import("@/modules/boards").then((m) => ({ default: m.BoardsHeaderView })),
  ),
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

const BOARD_LIST_WAIT_MS = 3000;

function prefetchBoard(
  queryClient: QueryClient,
  board: BoardKey,
  doneLimit: number,
): void {
  if (
    shouldPrefetchBoard(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: boardSnapshotKeys.board(board) }),
    )
  ) {
    void queryClient
      .ensureQueryData(boardSnapshotQueryOptions(board, doneLimit))
      .catch(() => undefined);
  }
}

async function loadSetup(queryClient: QueryClient) {
  const setupOptions = setupQueryOptions();
  if (queryClient.getQueryState(setupOptions.queryKey)?.status === "error") {
    return null;
  }
  try {
    return await queryClient.ensureQueryData({
      ...setupOptions,
      staleTime: Infinity,
      gcTime: Infinity,
    });
  } catch (err) {
    console.error("getSetup failed", err);
    return null;
  }
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  appStore: AppStore;
  rememberedBoard: string | null;
}>()({
  validateSearch: (search: Record<string, unknown>) =>
    search as { board?: unknown } & Record<string, unknown>,
  search: { middlewares: [retainSearchParams(["board"])] },
  beforeLoad: async ({ context, search, cause, location }) => {
    const { queryClient, appStore } = context;
    const remembered = context.rememberedBoard;
    if (
      search.board === undefined &&
      (remembered === null || remembered === DEFAULT_BOARD_KEY)
    ) {
      const state = appStore.getState();
      prefetchBoard(
        queryClient,
        DEFAULT_BOARD_KEY,
        state.board === DEFAULT_BOARD_KEY ? state.doneLimit : DONE_PAGE_SIZE,
      );
    }
    const cached = queryClient.getQueryData(boardListQueryOptions().queryKey);
    const listFromCache = cached !== undefined;
    const switching =
      cause !== "enter" &&
      typeof search.board === "string" &&
      search.board !== appStore.getState().board;
    const [setup, loaded] = await Promise.all([
      loadSetup(queryClient),
      withTimeout(
        (switching
          ? queryClient.fetchQuery({ ...boardListQueryOptions(), staleTime: 0 })
          : queryClient.ensureQueryData(boardListQueryOptions())
        )
          .then((list) => list.boards)
          .catch(() => cached?.boards),
        cause === "enter" || switching ? BOARD_LIST_WAIT_MS : 0,
      ),
    ]);
    let boards = loaded ?? (switching ? cached?.boards : undefined);
    if (cause === "enter" && search.board === undefined) {
      const entry = entryBoard(context.rememberedBoard, boards);
      if (entry !== null) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw redirect({
          to: location.pathname,
          search: { ...search, board: entry },
          replace: true,
        });
      }
    }
    let choice = selectBoard(search.board, boards);
    if (
      choice.unavailable !== null &&
      boards !== undefined &&
      listFromCache &&
      !switching
    ) {
      const fresh = await withTimeout(
        queryClient
          .fetchQuery({ ...boardListQueryOptions(), staleTime: 0 })
          .then((list) => list.boards)
          .catch(() => undefined),
        BOARD_LIST_WAIT_MS,
      );
      boards = fresh ?? boards;
      choice = selectBoard(search.board, boards);
    }
    if (choice.unavailable !== null) {
      toast(unavailableBoardMessage(choice.unavailable));
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: location.pathname,
        search: { ...search, board: undefined },
        replace: true,
      });
    }
    appStore.setBoard(choice.key);
    prefetchBoard(queryClient, choice.key, appStore.getState().doneLimit);
    return { setup };
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
