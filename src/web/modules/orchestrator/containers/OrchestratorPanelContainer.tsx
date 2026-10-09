import { useEffect, useRef, useState } from "react";
import {
  useNavigate,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { OrchestratorPanel } from "@/modules/orchestrator/components/OrchestratorPanel";
import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";
import { PanelControls } from "@/modules/orchestrator/components/PanelControls";
import { PanelHeader } from "@/modules/orchestrator/components/PanelHeader";
import {
  PanelTabs,
  type PanelTab,
} from "@/modules/orchestrator/components/PanelTabs";
import { TerminalFrame } from "@/modules/orchestrator/components/TerminalFrame";
import { DecisionsContainer } from "./DecisionsContainer";
import { OrchestratorsContainer } from "./OrchestratorsContainer";
import { PolicyContainer } from "./PolicyContainer";
import { StoppedLoopsContainer } from "./StoppedLoopsContainer";
import { useDecisionsModel } from "./use-decisions-model";
import {
  failureCopy,
  loadErrorCopy,
  panelModel,
  staleBadgeText,
  type ControlKind,
} from "@/modules/orchestrator/domain/panel-model";
import { focusEntryButton } from "@/modules/orchestrator/hooks/focus-entry";
import {
  useBoardRecordQuery,
  useEnsureOrchestratorTerminalMutation,
  useLifecycleMutation,
  useOrchestratorPanelQuery,
} from "@/modules/orchestrator/queries/orchestrator-queries";

const NO_ORCHESTRATORS: never[] = [];

export function OrchestratorPanelContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const boardKey = useAppStore(appStore, (s) => s.board);
  const stale = useAppStore(appStore, (s) => s.connection === "disconnected");
  const detailOpen = useAppStore(appStore, (s) => s.selectedCardId !== null);
  const doneLimit = useAppStore(appStore, (s) => s.doneLimit);
  const record = useBoardRecordQuery(boardKey).data ?? null;
  const panel = useOrchestratorPanelQuery(boardKey, true);
  const lifecycle = useLifecycleMutation(boardKey);
  const { mutateAsync: ensureTerminal } =
    useEnsureOrchestratorTerminalMutation();
  const linkedTab = useSearch({ from: "/board/{-$id}" }).tab;
  const [tab, setTab] = useState<PanelTab>(linkedTab ?? "terminal");
  const [failure, setFailure] = useState<{
    kind: ControlKind;
    reason: string;
  } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const spawnedFor = useRef<string | null>(null);

  const orchestrators = panel.data ?? NO_ORCHESTRATORS;
  const loaded = panel.data !== undefined;
  const decisions = useDecisionsModel(boardKey, doneLimit, orchestrators);
  const model = panelModel({
    orchestrators,
    supervisor: record?.policy.supervisor ?? "on",
    stale,
    pending: lifecycle.isPending ? lifecycle.variables.kind : null,
    decisionCount: decisions.count,
    loaded,
  });
  const loading = panel.isPending;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const session = model.main?.session ?? null;
  const sessionCard = session?.cardId;
  const sessionId = session?.activeSessionId ?? "";
  const needsTerminal =
    session !== null &&
    session.ttydPort === null &&
    session.hasTmuxSession &&
    session.state !== "lost";
  useEffect(() => {
    if (!needsTerminal || sessionCard === undefined) {
      spawnedFor.current = null;
      return;
    }
    const key = `${sessionCard}:${sessionId}`;
    if (spawnedFor.current === key) return;
    spawnedFor.current = key;
    void ensureTerminal(sessionCard).then((result) => {
      if (!result.ok && spawnedFor.current === key) spawnedFor.current = null;
    });
  }, [needsTerminal, sessionCard, sessionId, ensureTerminal]);

  function close() {
    void navigate({
      to: "/board/{-$id}",
      search: (prev) => ({ ...prev, panel: undefined, tab: undefined }),
    });
    focusEntryButton();
  }

  async function run(kind: ControlKind) {
    setFailure(null);
    const result = await lifecycle.mutateAsync({
      kind,
      id: model.main?.id ?? "main",
      hasRecord: model.main !== null,
    });
    if (!result.ok) setFailure({ kind, reason: result.reason });
  }

  const alertMessage =
    failure !== null
      ? failureCopy(failure.kind, failure.reason)
      : panel.isError
        ? loadErrorCopy(panel.error.message)
        : model.startFailure;
  const staleBadge =
    stale && panel.dataUpdatedAt > 0
      ? staleBadgeText(
          new Date(panel.dataUpdatedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        )
      : null;

  return (
    <OrchestratorPanel
      panelRef={panelRef}
      escapeEnabled={!detailOpen}
      onClose={close}
      header={
        <PanelHeader
          boardName={record?.name ?? boardKey}
          state={model.stateKey}
          transition={model.transition}
          staleBadge={staleBadge}
          loading={loading}
          onClose={close}
        />
      }
      controls={
        <PanelControls
          control={model.control}
          loading={loading}
          onRun={(kind) => void run(kind)}
        />
      }
      stoppedLoops={
        <StoppedLoopsContainer
          board={boardKey}
          loops={decisions.loops}
          stale={stale}
        />
      }
      alert={
        alertMessage === null ? null : (
          <PanelAlertBar
            message={alertMessage}
            retryDisabled={stale || lifecycle.isPending}
            onRetry={() =>
              failure !== null
                ? void run(failure.kind)
                : panel.isError
                  ? void panel.refetch()
                  : void run("start")
            }
          />
        )
      }
      tabs={
        <PanelTabs
          tab={tab}
          onTabChange={setTab}
          labels={model.tabs}
          decisions={
            <DecisionsContainer
              board={boardKey}
              views={decisions.views}
              rows={decisions.rows}
              loading={decisions.loading}
              stale={stale}
            />
          }
          policy={<PolicyContainer key={boardKey} board={boardKey} />}
          orchestrators={
            <OrchestratorsContainer
              board={boardKey}
              orchestrators={orchestrators}
              cards={decisions.cards}
              loading={!loaded}
            />
          }
          terminal={
            <TerminalFrame
              mode={model.terminal}
              src={model.terminalSrc}
              loading={loading}
            />
          }
        />
      }
    />
  );
}
