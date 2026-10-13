import { useEffect, useRef } from "react";
import { NARROW_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { CentrePane } from "@/modules/orchestrator/components/CentrePane";
import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";
import { TerminalFrame } from "@/modules/orchestrator/components/TerminalFrame";
import { regionErrorText } from "@/modules/orchestrator/domain/centre-page-state";
import {
  terminalFor,
  terminalSrcFor,
} from "@/modules/orchestrator/domain/panel-model";
import { useEnsureOrchestratorTerminalMutation } from "@/modules/orchestrator/queries/orchestrator-queries";
import { useCentreSelection } from "./use-centre-selection";

interface CentrePaneContainerProps {
  inTab?: boolean;
}

export function CentrePaneContainer({
  inTab = false,
}: CentrePaneContainerProps) {
  const { panel, record, unknown } = useCentreSelection();
  const wide = !useMediaQuery(NARROW_QUERY);
  const { mutateAsync: ensureTerminal } =
    useEnsureOrchestratorTerminalMutation();
  const spawnedFor = useRef<string | null>(null);

  const loaded = panel.data !== undefined && !unknown;
  const mode = loaded ? terminalFor(record) : "unavailable";
  const session = record?.session ?? null;
  const sessionCard = session?.cardId;
  const sessionId = session?.activeSessionId ?? "";
  const needsTerminal =
    session !== null &&
    session.ttydPort === null &&
    session.hasTmuxSession &&
    session.state !== "lost";

  useEffect(() => {
    if (wide === inTab || !needsTerminal || sessionCard === undefined) {
      spawnedFor.current = null;
      return;
    }
    const key = `${sessionCard}:${sessionId}`;
    if (spawnedFor.current === key) return;
    spawnedFor.current = key;
    void ensureTerminal(sessionCard).then((result) => {
      if (!result.ok && spawnedFor.current === key) spawnedFor.current = null;
    });
  }, [wide, inTab, needsTerminal, sessionCard, sessionId, ensureTerminal]);

  if (wide === inTab) return null;
  const frame =
    panel.data === undefined && panel.error !== null ? (
      <PanelAlertBar
        message={regionErrorText("Terminal", panel.error.message)}
        retryDisabled={false}
        onRetry={() => void panel.refetch()}
      />
    ) : (
      <TerminalFrame
        mode={mode}
        src={terminalSrcFor(mode, record)}
        loading={panel.isPending}
      />
    );
  return inTab ? frame : <CentrePane terminal={frame} />;
}
