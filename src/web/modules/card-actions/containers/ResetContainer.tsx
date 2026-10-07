import { useRouteContext } from "@tanstack/react-router";
import { actionablePinnedCard } from "../../../../shared/pinned-card.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { ResetDialog } from "@/modules/card-actions/components/ResetDialog";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { resetCard as resetCardApi } from "@/queries/cards-api";

export function ResetContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useBoardSnapshot(
    useAppStore(appStore, (s) => s.board),
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const resetCardId = useAppStore(appStore, (s) => s.resetCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const resetCard =
    board?.cards.find((card) => card.id === resetCardId) ??
    actionablePinnedCard(resetCardId, pinned);
  if (resetCard == null) return null;

  const requestReset = () => {
    const { id, identifier } = resetCard;
    void resetCardApi(id)
      .then((result) => {
        appStore.notice(
          result.ok ? `${identifier} reset to Inbox.` : result.error,
        );
      })
      .catch((err: unknown) => {
        console.error("resetCard failed", err);
        appStore.notice(`Couldn't reset ${identifier}.`);
      });
  };

  return (
    <ResetDialog
      key={resetCardId}
      card={resetCard}
      onConfirm={requestReset}
      onClose={appStore.closeReset}
    />
  );
}
