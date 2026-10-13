import { useNavigate, useSearch } from "@tanstack/react-router";
import { staleText } from "../../../../shared/stale-text.js";
import type { SettingsTab } from "../../../../shared/orchestrator-settings.js";
import type { Card } from "../../../../shared/types.js";
import { CentreRegionAlert } from "@/modules/orchestrator/components/CentreRegionAlert";
import { SettingsSheet } from "@/modules/orchestrator/components/SettingsSheet";
import {
  orchestratorsTabLabel,
  regionErrorText,
} from "@/modules/orchestrator/domain/centre-page-state";
import { useBoardRecordQuery } from "@/modules/orchestrator/queries/orchestrator-queries";
import { OrchestratorsContainer } from "./OrchestratorsContainer";
import { PolicyContainer } from "./PolicyContainer";
import { useCentreSelection } from "./use-centre-selection";

const NO_CARDS: Card[] = [];
const ROUTE = "/boards/$key/orchestrator/{-$id}";

export function SettingsSheetContainer() {
  const { boardKey, stale, panel, snapshot, records } = useCentreSelection();
  const { settings } = useSearch({ from: ROUTE });
  const navigate = useNavigate({ from: ROUTE });
  const boardName = useBoardRecordQuery(boardKey).data?.name ?? boardKey;

  function setSettings(next: SettingsTab | undefined) {
    void navigate({
      search: (prev) => ({ ...prev, settings: next }),
      replace: true,
    });
  }

  return (
    <SettingsSheet
      open={settings !== undefined}
      onClose={() => setSettings(undefined)}
      tab={settings ?? "policy"}
      onTabChange={setSettings}
      boardName={boardName}
      staleBadge={staleText(stale, panel.dataUpdatedAt)}
      orchestratorsLabel={orchestratorsTabLabel(
        panel.data === undefined ? null : records.length,
      )}
      policy={<PolicyContainer key={boardKey} board={boardKey} />}
      orchestrators={
        panel.isError ? (
          <CentreRegionAlert
            message={regionErrorText("Orchestrators", panel.error.message)}
            onRetry={() => void panel.refetch()}
          />
        ) : (
          <OrchestratorsContainer
            board={boardKey}
            orchestrators={records}
            cards={snapshot.data?.cards ?? NO_CARDS}
            loading={panel.data === undefined}
          />
        )
      }
    />
  );
}
