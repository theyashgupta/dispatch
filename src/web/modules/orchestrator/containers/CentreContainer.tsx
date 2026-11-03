import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { NARROW_QUERY } from "../../../../shared/media-queries.js";
import type { CentreView } from "../../../../shared/orchestrator-settings.js";
import { pinFromBoard } from "../../../../shared/pinned-card.js";
import type { Card, OrchestrationSummary } from "../../../../shared/types.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { readClock, subscribeClock } from "@/components/ui/hooks/wake-clock";
import { useOrchestrationSummaryQuery } from "@/queries/orchestration-summary-queries";
import { BranchList } from "@/modules/orchestrator/components/BranchList";
import type { TileBehaviour } from "@/modules/orchestrator/components/BranchTile";
import { CentreCanvas } from "@/modules/orchestrator/components/CentreCanvas";
import { CentreTree } from "@/modules/orchestrator/components/CentreTree";
import { CentreNarrow } from "@/modules/orchestrator/components/CentreNarrow";
import { CentreNotReady } from "@/modules/orchestrator/components/CentreNotReady";
import { StaleReason } from "@/modules/orchestrator/components/StaleReason";
import { centreGraph } from "@/modules/orchestrator/domain/centre-graph";
import {
  centreTree,
  treeFocusOrder,
} from "@/modules/orchestrator/domain/centre-tree";
import {
  CENTRE_FOCUS_ID,
  focusOrder,
} from "@/modules/orchestrator/domain/centre-focus";
import {
  regionErrorText,
  regionState,
  shownView,
} from "@/modules/orchestrator/domain/centre-page-state";
import { STALE_REASON } from "@/modules/orchestrator/domain/centre-model";
import { withGroupCosts } from "@/modules/orchestrator/domain/group-costs";
import { useCentrePane } from "@/modules/orchestrator/hooks/use-centre-pane";
import { useEdgePaths } from "@/modules/orchestrator/hooks/use-edge-paths";
import { useTileFocus } from "@/modules/orchestrator/hooks/use-tile-focus";
import { CentreControlsContainer } from "./CentreControlsContainer";
import { useBranchActions } from "./use-branch-actions";
import { useCentreControl } from "./use-centre-control";
import { useCentreSelection } from "./use-centre-selection";
import { useCentreView } from "./use-centre-view";
import { useOrchestratorDecisions } from "./use-orchestrator-decisions";

const NO_CARDS: Card[] = [];
const NO_GROUPS: OrchestrationSummary["groups"] = [];
const REASON_ID = "centre-actions-off";

export function CentreContainer() {
  const {
    appStore,
    boardKey,
    id,
    stale,
    list,
    snapshot,
    records,
    record,
    unknown,
  } = useCentreSelection();
  const decisions = useOrchestratorDecisions(boardKey);
  const navigate = useNavigate();
  const wide = !useMediaQuery(NARROW_QUERY);
  const requested = useCentreView();
  const now = useSyncExternalStore(subscribeClock, readClock);
  const cards = snapshot.data?.cards ?? NO_CARDS;
  const actions = useBranchActions(boardKey, cards);
  const start = useCentreControl(boardKey, null, stale);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const summary = useOrchestrationSummaryQuery(boardKey);
  const graph = useMemo(
    () =>
      withGroupCosts(
        centreGraph({
          cards,
          records,
          selectedId: record?.id ?? null,
          decisions: decisions.decisions,
          now,
        }),
        summary.data?.groups ?? NO_GROUPS,
      ),
    [cards, records, record, decisions.decisions, now, summary.data],
  );
  const view = shownView(requested, records, wide);
  const tree = useMemo(() => centreTree({ cards, records }), [cards, records]);
  const order = useMemo(
    () => (view === "tree" ? treeFocusOrder(tree) : focusOrder(graph)),
    [view, tree, graph],
  );
  const { register, onKeyDown } = useTileFocus(order);
  const { reset } = useCentrePane();

  useEffect(() => reset, [reset]);
  const branchIds = graph.branches.map((b) => b.id).join("\n");
  const [seenIds, setSeenIds] = useState(branchIds);
  if (branchIds !== seenIds && graph.centre !== null) {
    setSeenIds(branchIds);
    const live = new Set(graph.branches.map((b) => b.id));
    const kept = [...expanded].filter((id) => live.has(id));
    if (kept.length !== expanded.size) setExpanded(new Set(kept));
  }

  const nodeKeyDown = onKeyDown(CENTRE_FOCUS_ID);
  const idsByView: Record<CentreView, string[]> = {
    tree: tree.edges.map((e) => `${e.from}:${e.to}`),
    bands: graph.branches.map((b) => `${b.id}:${b.band}`),
  };
  const edgeIds = wide ? idsByView[view] : [];
  const { container, paths } = useEdgePaths(edgeIds);

  const queries = [list, snapshot];
  const failed = queries.find((q) => q.data === undefined && q.error !== null);
  const failure = failed?.error ?? decisions.error;
  const state = regionState({
    loading: queries.some((q) => q.data === undefined) || decisions.pending,
    error: failure !== null || unknown,
    empty: list.data !== undefined && records.length === 0,
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
    draftOf: actions.draftOf,
    setDraft: actions.setDraft,
    expanded: (branch) => expanded.has(branch.id),
    onToggle: (branch) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(branch.id)) next.delete(branch.id);
        else next.add(branch.id);
        return next;
      }),
  };

  const startReason = start.control?.reason ?? null;
  const ready = state === "ready";
  const notReady = (
    <CentreNotReady
      state={state}
      error={{
        message: regionErrorText(
          "Canvas",
          failure?.message ?? `no orchestrator ${id ?? "main"} on this board`,
        ),
        onRetry: () => {
          for (const q of queries) {
            if (q.error !== null || (unknown && q === list)) {
              void q.refetch();
            }
          }
          if (decisions.error !== null) decisions.refetch();
        },
      }}
      start={{
        startDisabled: start.control?.disabled ?? true,
        reason: startReason === STALE_REASON ? null : startReason,
        onStart: () => void start.run("start"),
        alert:
          start.failure === null
            ? null
            : {
                message: start.failure,
                onRetry: start.retryFailed,
                retryDisabled: stale || start.pending,
              },
      }}
    />
  );

  if (wide) {
    return ready ? (
      <>
        {stale && <StaleReason id={REASON_ID} padded />}
        {view === "tree" ? (
          <CentreTree
            tree={tree}
            paths={paths}
            containerRef={container}
            register={register}
            onKeyDown={onKeyDown}
            onOpenGroup={(cardId) =>
              appStore.selectCard(cardId, pinFromBoard(cardId, cards))
            }
            onSelectOrchestrator={(orchestratorId) =>
              void navigate({
                to: "/boards/$key/orchestrator/{-$id}",
                params: { key: boardKey, id: orchestratorId },
                search: (prev) => ({ ...prev, view: undefined }),
              })
            }
          />
        ) : (
          <CentreCanvas
            graph={graph}
            paths={paths}
            containerRef={container}
            nodeRef={register(CENTRE_FOCUS_ID)}
            onNodeKeyDown={nodeKeyDown}
            tile={tile}
          />
        )}
      </>
    ) : (
      notReady
    );
  }

  return (
    <CentreNarrow
      controls={<CentreControlsContainer inline />}
      centre={ready ? graph.centre : null}
      nodeRef={register(CENTRE_FOCUS_ID)}
      onNodeKeyDown={nodeKeyDown}
      reason={stale ? <StaleReason id={REASON_ID} padded={false} /> : null}
      branches={
        ready ? <BranchList bands={graph.bands} tile={tile} /> : notReady
      }
    />
  );
}
