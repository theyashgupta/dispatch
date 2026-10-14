import { useNavigate } from "@tanstack/react-router";
import { NARROW_QUERY } from "../../../../shared/media-queries.js";
import { staleText } from "../../../../shared/stale-text.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { CentreToolbar } from "@/modules/orchestrator/components/CentreToolbar";
import { PanelControls } from "@/modules/orchestrator/components/PanelControls";
import {
  CENTRE_CONTROL_LABELS,
  showSwitcher,
  switcherOptions,
} from "@/modules/orchestrator/domain/centre-page-state";
import { STALE_REASON } from "@/modules/orchestrator/domain/panel-model";
import { useCentreControl } from "./use-centre-control";
import { useCentreSelection } from "./use-centre-selection";

interface CentreControlsContainerProps {
  inline?: boolean;
}

export function CentreControlsContainer({
  inline = false,
}: CentreControlsContainerProps) {
  const { boardKey, id, stale, panel, snapshot, records, record, unknown } =
    useCentreSelection();
  const navigate = useNavigate();
  const wide = !useMediaQuery(NARROW_QUERY);
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

  if (wide === inline) return null;
  return (
    <CentreToolbar
      inline={inline}
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
          to: "/boards/$key/orchestrator/{-$id}",
          params: { key: boardKey, id },
          search: (prev) => ({ ...prev, settings: "policy" }),
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
