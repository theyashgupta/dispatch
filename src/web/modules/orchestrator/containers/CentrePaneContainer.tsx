import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { SidePanel } from "@/components/ui/side-panel";
import { CentrePane } from "@/modules/orchestrator/components/CentrePane";
import { CentreAlertBar } from "@/modules/orchestrator/components/CentreAlertBar";
import { TerminalFrame } from "@/modules/orchestrator/components/TerminalFrame";
import {
  CENTRE_WIDTH_KEY,
  isTerminalReady,
} from "@/modules/orchestrator/domain/centre-pane";
import { regionErrorText } from "@/modules/orchestrator/domain/centre-page-state";
import {
  terminalFor,
  terminalSrcFor,
} from "@/modules/orchestrator/domain/centre-model";
import { focusTerminalButton } from "@/modules/orchestrator/hooks/focus-entry";
import { useCentreAlertSlot } from "@/modules/orchestrator/hooks/use-centre-pane";
import { useCentrePaneMode } from "@/modules/orchestrator/hooks/use-centre-pane-mode";
import { useEnsureOrchestratorTerminalMutation } from "@/modules/orchestrator/queries/orchestrator-queries";
import { useCentreSelection } from "./use-centre-selection";

interface CentrePaneContainerProps {
  canvas: ReactNode;
}

export function CentrePaneContainer({ canvas }: CentrePaneContainerProps) {
  const { list, record, unknown } = useCentreSelection();
  const loaded = list.data !== undefined && !unknown;
  const mode = loaded ? terminalFor(record) : "unavailable";
  const terminalReady = isTerminalReady(mode);
  const { paneMode, expanded, setExpanded, setOpen } =
    useCentrePaneMode(terminalReady);
  const close = useCallback(() => {
    setOpen(false);
    focusTerminalButton();
  }, [setOpen]);
  const [, setAlertSlot] = useCentreAlertSlot();
  const { mutateAsync: ensureTerminal } =
    useEnsureOrchestratorTerminalMutation();
  const spawnedFor = useRef<string | null>(null);

  const session = record?.session ?? null;
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

  const src = terminalSrcFor(mode, record);
  const frame =
    list.data === undefined && list.error !== null ? (
      <CentreAlertBar
        message={regionErrorText("Terminal", list.error.message)}
        retryDisabled={false}
        onRetry={() => void list.refetch()}
      />
    ) : (
      <TerminalFrame
        key={src ?? mode}
        mode={mode}
        src={src}
        loading={list.isPending}
      />
    );
  return (
    <SidePanel
      placement="inline"
      title="Terminal"
      handleLabel="Resize terminal"
      storageKey={CENTRE_WIDTH_KEY}
      open={paneMode !== "closed"}
      onClose={close}
      expanded={paneMode === "expanded"}
      sheet={paneMode === "sheet"}
      main={canvas}
      panel={
        <CentrePane
          terminal={frame}
          alertSlot={setAlertSlot}
          expanded={paneMode === "expanded"}
          onToggleExpand={() => setExpanded(!expanded)}
          onClose={close}
          sheet={paneMode === "sheet"}
          terminalReady={terminalReady}
        />
      }
    />
  );
}
