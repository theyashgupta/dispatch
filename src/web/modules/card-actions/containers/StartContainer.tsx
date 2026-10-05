import { useRef, useState } from "react";
import type { Card } from "../../../../shared/types.js";
import { StartDialog } from "@/modules/card-actions/components/StartDialog";
import { useStartFlow } from "./use-start-flow";
import { startFailure } from "@/modules/card-actions/domain/start-copy";
import { buildStartCardRequest } from "@/modules/card-actions/domain/start-request";
import { useDialogClose } from "@/modules/card-actions/hooks/use-dialog-close";
import { useStartCardMutation } from "@/queries/cards-queries";

export interface StartContainerProps {
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
