import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { staleText } from "../../../../shared/stale-text.js";
import {
  ORCHESTRATOR_SETTINGS_TABS,
  type OrchestratorSettingsTab,
} from "../../../../shared/orchestrator-settings.js";
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
  const navigate = useNavigate({ from: ROUTE });
  const router = useRouter();
  const { settings, index } = useLocation({
    select: (l) => ({
      settings: ORCHESTRATOR_SETTINGS_TABS.find(
        (tab) => tab === l.search.settings,
      ),
      index: l.state.__TSR_index,
    }),
  });
  const boardName = useBoardRecordQuery(boardKey).data?.name ?? boardKey;
  const closedAt = useRef<number | null>(null);
  const [lastTab, setLastTab] = useState<OrchestratorSettingsTab>("policy");
  if (settings !== undefined && settings !== lastTab) setLastTab(settings);

  useEffect(() => {
    if (settings === undefined) closedAt.current = index;
  }, [settings, index]);

  function setSettings(next: OrchestratorSettingsTab | undefined) {
    void navigate({
      search: (prev) => ({ ...prev, settings: next }),
      replace: true,
    });
  }

  function close() {
    if (closedAt.current !== null && index === closedAt.current + 1) {
      router.history.back();
    } else {
      setSettings(undefined);
    }
  }

  return (
    <SettingsSheet
      open={settings !== undefined}
      onClose={close}
      tab={settings ?? lastTab}
      onTabChange={setSettings}
      boardName={boardName}
      staleBadge={staleText(stale, snapshot.dataUpdatedAt)}
      orchestratorsLabel={orchestratorsTabLabel(
        panel.data === undefined ? null : records.length,
      )}
      policy={<PolicyContainer key={boardKey} board={boardKey} />}
      orchestrators={
        panel.data === undefined && panel.isError ? (
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
