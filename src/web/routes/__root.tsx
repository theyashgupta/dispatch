import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, useRouter } from "@tanstack/react-router";
import { App, BootScreen } from "@/App";
import {
  boardSnapshotKeys,
  boardSnapshotQueryOptions,
  shouldPrefetchBoard,
} from "@/queries/board-snapshot-queries";
import { setupQueryOptions } from "@/modules/setup";
import { DONE_PAGE_SIZE } from "../../shared/done-limit.js";
import { notFoundTarget } from "../../shared/route.js";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
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
  component: App,
  notFoundComponent: RootNotFound,
});

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
