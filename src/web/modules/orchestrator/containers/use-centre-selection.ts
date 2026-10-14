import { useParams, useRouteContext } from "@tanstack/react-router";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import {
  selectedRecord,
  unknownOrchestrator,
} from "@/modules/orchestrator/domain/centre-page-state";
import type { OrchestratorView } from "@/modules/orchestrator/domain/centre-model";
import { useOrchestratorCentreQuery } from "@/modules/orchestrator/queries/orchestrator-queries";
import { useBoardSnapshotQuery } from "@/queries/board-snapshot-queries";

const NO_RECORDS: OrchestratorView[] = [];

/**
 * Read what every region of the command centre shares: the board, the orchestrator in the path, its record, the board snapshot and the stream state.
 *
 * @remarks `unknown` is true once the records loaded and the path names no orchestrator, or the board has records but no main. Each region container calls this hook, and TanStack Query shares one 3 s poll of the records between them.
 */
export function useCentreSelection() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const { id } = useParams({ from: "/boards/$key/orchestrator/{-$id}" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  const stale = useAppStore(appStore, (s) => s.connection === "disconnected");
  const doneLimit = useAppStore(appStore, (s) => s.doneLimit);
  const list = useOrchestratorCentreQuery(boardKey, true);
  const snapshot = useBoardSnapshotQuery(boardKey, doneLimit);
  const records = list.data ?? NO_RECORDS;
  const record = selectedRecord(records, id);
  const unknown =
    list.data !== undefined &&
    (unknownOrchestrator(records, id) ||
      (records.length > 0 && record === null));
  return {
    appStore,
    boardKey,
    id,
    stale,
    list,
    snapshot,
    records,
    record,
    unknown,
  };
}
