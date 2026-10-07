import { useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import type { Card } from "../../../../shared/types.js";
import { defaultTeamId } from "../../../../shared/linear-state.js";
import { SyncToLinearDialog } from "@/modules/card-actions/components/SyncToLinearDialog";
import {
  SYNC_FAILED_COPY,
  TEAM_DEFAULT_STATE,
  stateIdOf,
} from "@/modules/card-actions/domain/sync-target";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useDialogClose } from "@/components/ui/hooks/use-dialog-close";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { useSyncCardToLinearMutation } from "@/queries/cards-queries";
import { useLinearWorkflowQuery } from "@/queries/linear-workflow-queries";

interface SyncToLinearContainerProps {
  card: Card;
  cards: readonly Card[];
  onClose: () => void;
}

export function SyncToLinearContainer({
  card,
  cards,
  onClose,
}: SyncToLinearContainerProps) {
  const { open, requestClose, onOpenChange } = useDialogClose(onClose);
  const workflow = useLinearWorkflowQuery();
  const sync = useSyncCardToLinearMutation();
  const [teamChoice, setTeamChoice] = useState<string | undefined>();
  const [stateChoice, setStateChoice] = useState(TEAM_DEFAULT_STATE);

  const teams = workflow.data?.teams ?? [];
  if (teamChoice === undefined && teams.length > 0) {
    setTeamChoice(defaultTeamId(cards, teams));
  }
  const loading =
    workflow.data === undefined && (workflow.isPending || workflow.isFetching);
  const loadError =
    workflow.isError && !loading ? workflow.error.message : null;
  const syncError =
    sync.data !== undefined && !sync.data.ok
      ? (sync.data.error ?? SYNC_FAILED_COPY)
      : null;

  const handleSync = async () => {
    if (!teamChoice) return;
    const result = await sync.mutateAsync({
      id: card.id,
      teamId: teamChoice,
      stateId: stateIdOf(stateChoice),
    });
    if (result.ok) requestClose();
  };

  return (
    <SyncToLinearDialog
      open={open}
      onOpenChange={onOpenChange}
      onCancel={requestClose}
      loading={loading}
      loadError={loadError}
      teams={teams}
      teamId={teamChoice}
      onTeamChange={(next) => {
        setTeamChoice(next);
        setStateChoice(TEAM_DEFAULT_STATE);
      }}
      stateChoice={stateChoice}
      onStateChange={setStateChoice}
      pending={sync.isPending}
      syncError={syncError}
      onSync={() => void handleSync()}
    />
  );
}

export function SyncToLinearRequestContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const syncCardId = useAppStore(appStore, (s) => s.syncCardId);
  const card = board?.cards.find((c) => c.id === syncCardId);
  if (card == null) return null;
  return (
    <SyncToLinearContainer
      key={syncCardId}
      card={card}
      cards={board?.cards ?? []}
      onClose={appStore.closeSync}
    />
  );
}
