import { useNavigate } from "@tanstack/react-router";
import { useBoardSnapshotQuery } from "@/queries/board-snapshot-queries";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { CentreToolbar } from "@/modules/orchestrator/components/CentreToolbar";
import { PanelControls } from "@/modules/orchestrator/components/PanelControls";
import {
  showSwitcher,
  staleText,
  switcherOptions,
  unknownOrchestrator,
} from "@/modules/orchestrator/domain/centre-page-state";
import { useCentreControl } from "./use-centre-control";
import { useCentreSelection } from "./use-centre-selection";

export function CentreControlsContainer() {
  const { appStore, boardKey, stale, panel, records, record, id } =
    useCentreSelection();
  const navigate = useNavigate();
  const doneLimit = useAppStore(appStore, (s) => s.doneLimit);
  const snapshot = useBoardSnapshotQuery(boardKey, doneLimit);
  const { control, run, failure, retryFailed, pending } = useCentreControl(
    boardKey,
    record,
    stale,
  );

  return (
    <CentreToolbar
      staleBadge={staleText(stale, snapshot.dataUpdatedAt)}
      switcher={
        showSwitcher(records) && record !== null
          ? {
              options: switcherOptions(records),
              value: record.id,
              onChange: (id) =>
                void navigate({
                  to: "/boards/$key/orchestrator/{-$id}",
                  params: { key: boardKey, id },
                }),
            }
          : null
      }
      controls={
        <PanelControls
          control={unknownOrchestrator(records, id) ? null : control}
          loading={panel.isPending}
          onRun={(kind) => void run(kind)}
        />
      }
      onSettings={() =>
        void navigate({
          to: "/boards/$key",
          params: { key: boardKey },
          search: (prev) => ({ ...prev, panel: "orchestrator", tab: "policy" }),
        })
      }
      alert={
        failure === null
          ? null
          : {
              message: failure,
              onRetry: retryFailed,
              retryDisabled: stale || pending,
            }
      }
    />
  );
}
