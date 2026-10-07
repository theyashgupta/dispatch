import { useRef, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { actionablePinnedCard } from "../../../../shared/pinned-card.js";
import { routeHash } from "../../../../shared/route.js";
import type { Card } from "../../../../shared/types.js";
import { StartDialog } from "@/modules/card-actions/components/StartDialog";
import { useStartFlow } from "./use-start-flow";
import { startFailure } from "@/modules/card-actions/domain/start-copy";
import { buildStartCardRequest } from "@/modules/card-actions/domain/start-request";
import { useDialogClose } from "@/components/ui/hooks/use-dialog-close";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { useStartCardMutation } from "@/queries/cards-queries";

interface StartContainerProps {
  card: Card;
  newSession?: boolean;
  extraDirection?: string;
  onClose: () => void;
  onEditPlaybooks: () => void;
}

export function StartContainer({
  card,
  newSession,
  extraDirection: initialExtraDirection,
  onClose,
  onEditPlaybooks,
}: StartContainerProps) {
  const { open, requestClose, onOpenChange } = useDialogClose(onClose);
  const start = useStartCardMutation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [extraDirection, setExtraDirection] = useState(
    initialExtraDirection ?? card.extraDirection ?? "",
  );
  const [inherit, setInherit] = useState(false);

  const flow = useStartFlow({
    open,
    requestClose,
    pending: start.isPending,
    focusRef: textareaRef,
    send: (picks) =>
      start.mutateAsync(
        buildStartCardRequest({
          cardId: card.id,
          extraDirection,
          folder: picks.folder,
          repos: picks.repos,
          playbook: picks.playbook,
          newSession: newSession === true,
          inherit,
          activeSessionId: card.activeSessionId,
        }),
      ),
    toFailure: startFailure,
  });

  return (
    <StartDialog
      open={open}
      onOpenChange={onOpenChange}
      onCancel={requestClose}
      card={card}
      newSession={newSession === true}
      inherit={inherit}
      onInheritChange={setInherit}
      workspace={flow.workspace.view}
      playbook={flow.playbook.view}
      onEditPlaybooks={onEditPlaybooks}
      extraDirection={extraDirection}
      onExtraDirectionChange={setExtraDirection}
      textareaRef={textareaRef}
      failure={flow.failure}
      pending={start.isPending}
      canStart={flow.canStart}
      onStart={() => void flow.start()}
    />
  );
}

export function StartRequestContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const request = useAppStore(appStore, (s) => s.start);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const card =
    board?.cards.find((c) => c.id === request?.cardId) ??
    actionablePinnedCard(request?.cardId, pinned);
  if (card == null || request == null) return null;
  return (
    <StartContainer
      key={`${request.cardId}:${request.newSession === true ? "new" : "start"}`}
      card={card}
      newSession={request.newSession === true}
      extraDirection={request.extraDirection}
      onClose={appStore.closeStart}
      onEditPlaybooks={() => {
        appStore.closeStart();
        void router.navigate({
          href: routeHash({ page: "playbooks" }).slice(1),
        });
      }}
    />
  );
}
