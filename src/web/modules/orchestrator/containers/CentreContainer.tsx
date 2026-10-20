import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { NARROW_QUERY } from "../../../../shared/media-queries.js";
import { pinFromBoard } from "../../../../shared/pinned-card.js";
import type { Card } from "../../../../shared/types.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { readClock, subscribeClock } from "@/components/ui/hooks/wake-clock";
import { BranchList } from "@/modules/orchestrator/components/BranchList";
import type { TileBehaviour } from "@/modules/orchestrator/components/BranchTile";
import { CentreCanvas } from "@/modules/orchestrator/components/CentreCanvas";
import { CentreNarrow } from "@/modules/orchestrator/components/CentreNarrow";
import { CentreNotReady } from "@/modules/orchestrator/components/CentreNotReady";
import { StaleReason } from "@/modules/orchestrator/components/StaleReason";
import { centreGraph } from "@/modules/orchestrator/domain/centre-graph";
import {
  CENTRE_FOCUS_ID,
  focusOrder,
  isPlainEnter,
} from "@/modules/orchestrator/domain/centre-focus";
import {
  regionErrorText,
  regionState,
} from "@/modules/orchestrator/domain/centre-page-state";
import { STALE_REASON } from "@/modules/orchestrator/domain/centre-model";
import { useCentrePane } from "@/modules/orchestrator/hooks/use-centre-pane";
import { useEdgePaths } from "@/modules/orchestrator/hooks/use-edge-paths";
import { useTileFocus } from "@/modules/orchestrator/hooks/use-tile-focus";
import { CentreControlsContainer } from "./CentreControlsContainer";
import { CentrePaneContainer } from "./CentrePaneContainer";
import { useBranchActions } from "./use-branch-actions";
import { useCentreControl } from "./use-centre-control";
import { useCentreSelection } from "./use-centre-selection";
import { useOrchestratorDecisions } from "./use-orchestrator-decisions";

const NO_CARDS: Card[] = [];
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
  const wide = !useMediaQuery(NARROW_QUERY);
  const now = useSyncExternalStore(subscribeClock, readClock);
  const cards = snapshot.data?.cards ?? NO_CARDS;
  const actions = useBranchActions(boardKey, cards);
  const start = useCentreControl(boardKey, null, stale);

  const graph = useMemo(
    () =>
      centreGraph({
        cards,
        records,
        selectedId: record?.id ?? null,
        decisions: decisions.decisions,
        now,
      }),
    [cards, records, record, decisions.decisions, now],
  );
  const order = useMemo(() => focusOrder(graph), [graph]);
  const { register, onKeyDown } = useTileFocus(order);
  const { page, setPage, requestCommentFocus, reset } = useCentrePane();

  useEffect(() => reset, [reset]);

  const nodeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      isPlainEnter(event) &&
      record !== null &&
      event.target === event.currentTarget
    ) {
      event.preventDefault();
      requestCommentFocus();
      return;
    }
    onKeyDown(CENTRE_FOCUS_ID)(event);
  };
  const { container, paths } = useEdgePaths(
    wide ? graph.branches.map((b) => `${b.id}:${b.band}`) : [],
  );

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
        <CentreCanvas
          graph={graph}
          paths={paths}
          containerRef={container}
          nodeRef={register(CENTRE_FOCUS_ID)}
          onNodeKeyDown={nodeKeyDown}
          tile={tile}
        />
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
      page={page}
      onPageChange={setPage}
      pane={<CentrePaneContainer inTab />}
    />
  );
}
