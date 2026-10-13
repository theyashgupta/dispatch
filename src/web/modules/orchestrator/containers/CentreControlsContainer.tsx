import { useNavigate } from "@tanstack/react-router";
import { useBoardSnapshotQuery } from "@/queries/board-snapshot-queries";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { CentreToolbar } from "@/modules/orchestrator/components/CentreToolbar";
import { PanelControls } from "@/modules/orchestrator/components/PanelControls";
import {
  CENTRE_CONTROL_LABELS,
  showSwitcher,
  staleText,
  switcherOptions,
} from "@/modules/orchestrator/domain/centre-page-state";
import { STALE_REASON } from "@/modules/orchestrator/domain/panel-model";
import { useCentreControl } from "./use-centre-control";
import { useCentreSelection } from "./use-centre-selection";

export function CentreControlsContainer() {
  const { appStore, boardKey, stale, panel, records, record, unknown } =
    useCentreSelection();
  const navigate = useNavigate();
  const doneLimit = useAppStore(appStore, (s) => s.doneLimit);
  const snapshot = useBoardSnapshotQuery(boardKey, doneLimit);
  const { control, run, failure, retryFailed, pending } = useCentreControl(
    boardKey,
    record,
    stale,
  );
  const emptyBoard = panel.data !== undefined && records.length === 0;
  const shown =
    control === null || unknown || emptyBoard
      ? null
      : {
          ...control,
          label: CENTRE_CONTROL_LABELS[control.kind],
          reason:
            stale && control.reason === STALE_REASON ? null : control.reason,
        };

  return (
    <CentreToolbar
      staleBadge={staleText(stale, snapshot.dataUpdatedAt)}
      switcher={
        showSwitcher(records)
          ? {
              options: switcherOptions(records),
              value: record?.id ?? "",
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
          control={shown}
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
