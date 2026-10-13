import { useParams, useRouteContext } from "@tanstack/react-router";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { selectedRecord } from "@/modules/orchestrator/domain/centre-page-state";
import type { OrchestratorView } from "@/modules/orchestrator/domain/panel-model";
import { useOrchestratorPanelQuery } from "@/modules/orchestrator/queries/orchestrator-queries";

const NO_RECORDS: OrchestratorView[] = [];

/**
 * Read what every region of the command centre shares: the board, the orchestrator in the path, its record and the stream state.
 *
 * @remarks Each region container calls this hook, and TanStack Query shares one 3 s poll of the records between them.
 */
export function useCentreSelection() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const { id } = useParams({ from: "/boards/$key/orchestrator/{-$id}" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  const stale = useAppStore(appStore, (s) => s.connection === "disconnected");
  const panel = useOrchestratorPanelQuery(boardKey, true);
  const records = panel.data ?? NO_RECORDS;
  return {
    appStore,
    boardKey,
    id,
    stale,
    panel,
    records,
    record: selectedRecord(records, id),
  };
}
