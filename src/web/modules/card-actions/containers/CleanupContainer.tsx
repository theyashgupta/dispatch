import { useEffect, useRef } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { actionablePinnedCard } from "../../../../shared/pinned-card.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { CleanupDialog } from "@/modules/card-actions/components/CleanupDialog";
import {
  cleanupAttemptEnded,
  cleanupOutcomeCopy,
  cleanupRequestFailedCopy,
} from "@/modules/card-actions/domain/cleanup-feedback";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { cleanupCard as cleanupCardApi } from "@/queries/cards-api";

export function CleanupContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useBoardSnapshot(
    useAppStore(appStore, (s) => s.board),
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const cleanupCardId = useAppStore(appStore, (s) => s.cleanupCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const cleanupCard =
    board?.cards.find((card) => card.id === cleanupCardId) ??
    actionablePinnedCard(cleanupCardId, pinned);

  const watchRef = useRef(new Map<string, number | undefined>());
  useEffect(() => {
    if (board == null) return;
    for (const [id, attempt] of watchRef.current) {
      const card = board.cards.find((c) => c.id === id);
      if (card == null || !cleanupAttemptEnded(card, attempt)) continue;
      watchRef.current.delete(id);
      const copy = cleanupOutcomeCopy(card);
      if (copy != null) appStore.notice(copy);
    }
  }, [board, appStore]);

  if (cleanupCard == null) return null;

  const requestCleanup = (force: boolean) => {
    const { id, identifier, cleanupAttempt } = cleanupCard;
    watchRef.current.set(id, cleanupAttempt);
    void cleanupCardApi(id, force).catch((err: unknown) => {
      console.error("cleanupCard failed", err);
      watchRef.current.delete(id);
      appStore.notice(cleanupRequestFailedCopy(identifier));
    });
  };

  return (
    <CleanupDialog
      key={cleanupCardId}
      card={cleanupCard}
      onConfirm={requestCleanup}
      onClose={appStore.closeCleanup}
    />
  );
}
