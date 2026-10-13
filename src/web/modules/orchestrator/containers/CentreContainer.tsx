import { useMemo, useState, useSyncExternalStore } from "react";
import { pinFromBoard } from "../../../../shared/pinned-card.js";
import type { Card } from "../../../../shared/types.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { readClock, subscribeClock } from "@/components/ui/hooks/wake-clock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BranchList } from "@/modules/orchestrator/components/BranchList";
import type { TileBehaviour } from "@/modules/orchestrator/components/BranchTile";
import { CentreCanvas } from "@/modules/orchestrator/components/CentreCanvas";
import { CentreNode } from "@/modules/orchestrator/components/CentreNode";
import {
  CentreLoading,
  NoOrchestrator,
} from "@/modules/orchestrator/components/CentreStates";
import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";
import { centreGraph } from "@/modules/orchestrator/domain/centre-graph";
import {
  CENTRE_FOCUS_ID,
  focusOrder,
} from "@/modules/orchestrator/domain/centre-focus";
import {
  NO_BRANCHES_TEXT,
  WIDE_QUERY,
  regionErrorText,
  regionState,
  unknownOrchestrator,
} from "@/modules/orchestrator/domain/centre-page-state";
import { STALE_REASON } from "@/modules/orchestrator/domain/panel-model";
import { useEdgePaths } from "@/modules/orchestrator/hooks/use-edge-paths";
import { useTileFocus } from "@/modules/orchestrator/hooks/use-tile-focus";
import { usePanelDecisionsQuery } from "@/modules/orchestrator/queries/orchestrator-queries";
import { useAnsweredDecisionsQuery } from "@/queries/attention-actions-queries";
import { useBoardSnapshotQuery } from "@/queries/board-snapshot-queries";
import { CentrePaneContainer } from "./CentrePaneContainer";
import { useBranchActions } from "./use-branch-actions";
import { useCentreControl } from "./use-centre-control";
import { useCentreSelection } from "./use-centre-selection";

const NO_CARDS: Card[] = [];
const REASON_ID = "centre-actions-off";

export function CentreContainer() {
  const { appStore, boardKey, id, stale, panel, records, record } =
    useCentreSelection();
  const doneLimit = useAppStore(appStore, (s) => s.doneLimit);
  const snapshot = useBoardSnapshotQuery(boardKey, doneLimit);
  const open = usePanelDecisionsQuery(boardKey);
  const answered = useAnsweredDecisionsQuery(boardKey);
  const wide = useMediaQuery(WIDE_QUERY);
  const now = useSyncExternalStore(subscribeClock, readClock);
  const [showOlderShipped, setShowOlderShipped] = useState(false);
  const cards = snapshot.data?.cards ?? NO_CARDS;
  const actions = useBranchActions(boardKey, cards);
  const start = useCentreControl(boardKey, null, stale);

  const graph = useMemo(
    () =>
      centreGraph({
        cards,
        records,
        selectedId: record?.id ?? null,
        decisions: [...(open.data ?? []), ...(answered.data ?? [])],
        now,
        showOlderShipped,
      }),
    [cards, records, record, open.data, answered.data, now, showOlderShipped],
  );
  const order = useMemo(() => focusOrder(graph), [graph]);
  const { register, onKeyDown } = useTileFocus(order);
  const { container, paths } = useEdgePaths(
    wide ? graph.branches.map((b) => b.id) : [],
  );

  const queries = [panel, snapshot, open, answered];
  const failed = queries.find((q) => q.data === undefined && q.error !== null);
  const unknown = unknownOrchestrator(records, id) && panel.data !== undefined;
  const state = regionState({
    loading: queries.some((q) => q.data === undefined),
    error: failed !== undefined || unknown,
    empty: panel.data !== undefined && records.length === 0,
  });

  const disabled = stale || actions.pending;
  const tile: TileBehaviour = {
    disabled,
    reasonId: stale ? REASON_ID : null,
    feedback: actions.feedback,
    register,
    onKeyDown,
    onOpen: (branch) => {
      if (branch.cardId === null) return;
      appStore.selectCard(branch.cardId, pinFromBoard(branch.cardId, cards));
    },
    onReply: actions.onReply,
    onAction: actions.onAction,
    onOpenTerminal: actions.onOpenTerminal,
    onRetry: actions.onRetry,
  };
  const toggleShipped = () => setShowOlderShipped((shown) => !shown);

  const notReady =
    state === "loading" ? (
      <CentreLoading />
    ) : state === "error" ? (
      <div className="p-(--space-xl)">
        <PanelAlertBar
          message={regionErrorText(
            "Canvas",
            failed?.error?.message ?? `no orchestrator ${id} on this board`,
          )}
          retryDisabled={false}
          onRetry={() => {
            for (const q of queries) {
              if (q.error !== null) void q.refetch();
            }
          }}
        />
      </div>
    ) : state === "empty" ? (
      <NoOrchestrator
        startDisabled={start.control?.disabled ?? true}
        reason={start.control?.reason ?? null}
        onStart={() => void start.run("start")}
      />
    ) : null;
  const reason = stale ? (
    <p
      id={REASON_ID}
      role="status"
      className="m-0 text-sm text-muted-foreground"
    >
      {STALE_REASON}
    </p>
  ) : null;

  if (wide) {
    return (
      notReady ?? (
        <>
          {reason !== null && (
            <div className="px-(--space-xl) pt-(--space-md)">{reason}</div>
          )}
          <CentreCanvas
            graph={graph}
            paths={paths}
            containerRef={container}
            nodeRef={register(CENTRE_FOCUS_ID)}
            onNodeKeyDown={onKeyDown(CENTRE_FOCUS_ID)}
            showOlderShipped={showOlderShipped}
            onToggleShipped={toggleShipped}
            tile={tile}
          />
        </>
      )
    );
  }

  const noBranches = graph.branches.length === 0 && graph.hiddenShipped === 0;
  return (
    <div className="flex flex-col gap-(--space-md) p-(--space-lg)">
      {notReady === null && graph.centre !== null && (
        <CentreNode
          node={graph.centre}
          compact
          nodeRef={register(CENTRE_FOCUS_ID)}
          onKeyDown={onKeyDown(CENTRE_FOCUS_ID)}
        />
      )}
      {reason}
      <Tabs defaultValue="branches" className="gap-(--space-md)">
        <TabsList variant="line" className="h-auto w-full justify-start">
          <TabsTrigger value="branches" className="flex-none">
            Branches
          </TabsTrigger>
          <TabsTrigger value="terminal" className="flex-none">
            Terminal
          </TabsTrigger>
        </TabsList>
        <TabsContent value="branches">
          {notReady ??
            (noBranches ? (
              <p className="m-0 text-sm text-muted-foreground">
                {NO_BRANCHES_TEXT}
              </p>
            ) : (
              <BranchList
                bands={graph.bands}
                hiddenShipped={graph.hiddenShipped}
                showOlderShipped={showOlderShipped}
                onToggleShipped={toggleShipped}
                tile={tile}
              />
            ))}
        </TabsContent>
        <TabsContent
          value="terminal"
          forceMount
          className="flex min-h-0 flex-col data-[state=inactive]:hidden"
        >
          <CentrePaneContainer inTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
