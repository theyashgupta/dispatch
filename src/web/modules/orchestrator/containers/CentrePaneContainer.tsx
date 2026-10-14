import { useEffect, useRef } from "react";
import { NARROW_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { CentrePane } from "@/modules/orchestrator/components/CentrePane";
import { CentreAlertBar } from "@/modules/orchestrator/components/CentreAlertBar";
import { TerminalFrame } from "@/modules/orchestrator/components/TerminalFrame";
import { regionErrorText } from "@/modules/orchestrator/domain/centre-page-state";
import {
  terminalFor,
  terminalSrcFor,
} from "@/modules/orchestrator/domain/centre-model";
import {
  useCentreAlertSlot,
  useCentrePane,
} from "@/modules/orchestrator/hooks/use-centre-pane";
import { useEnsureOrchestratorTerminalMutation } from "@/modules/orchestrator/queries/orchestrator-queries";
import { ConversationContainer } from "./ConversationContainer";
import { useCentreSelection } from "./use-centre-selection";

interface CentrePaneContainerProps {
  inTab?: boolean;
}

export function CentrePaneContainer({
  inTab = false,
}: CentrePaneContainerProps) {
  const { list, record, unknown } = useCentreSelection();
  const wide = !useMediaQuery(NARROW_QUERY);
  const { pane, setPane } = useCentrePane();
  const [, setAlertSlot] = useCentreAlertSlot();
  const { mutateAsync: ensureTerminal } =
    useEnsureOrchestratorTerminalMutation();
  const spawnedFor = useRef<string | null>(null);

  const loaded = list.data !== undefined && !unknown;
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
    <CentrePane
      value={pane}
      onValueChange={setPane}
      conversation={<ConversationContainer />}
      terminal={frame}
      alertSlot={setAlertSlot}
    />
  );
}
