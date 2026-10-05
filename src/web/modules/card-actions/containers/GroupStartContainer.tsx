import { useEffect, useRef, useState } from "react";
import type { Card } from "../../../../shared/types.js";
import { GroupStartDialog } from "@/modules/card-actions/components/GroupStartDialog";
import { useStartFlow } from "./use-start-flow";
import {
  composeGroupTitle,
  deterministicGroupTitle,
  shouldAcceptGeneratedPhrase,
} from "@/modules/card-actions/domain/group-title";
import { groupStartFailure } from "@/modules/card-actions/domain/start-copy";
import { buildStartGroupRequest } from "@/modules/card-actions/domain/start-request";
import { useDialogClose } from "@/modules/card-actions/hooks/use-dialog-close";
import {
  useGenerateGroupTitleMutation,
  useStartGroupMutation,
} from "@/queries/cards-queries";

export interface GroupStartContainerProps {
  members: Card[];
  onClose: () => void;
  onStarted?: () => void;
  onEditPlaybooks: () => void;
}

export function GroupStartContainer({
  members,
  onClose,
  onStarted,
  onEditPlaybooks,
}: GroupStartContainerProps) {
  const { open, requestClose, onOpenChange } = useDialogClose(onClose);
  const startGroup = useStartGroupMutation();
  const { mutateAsync: generateTitle } = useGenerateGroupTitleMutation();
  const titleRef = useRef<HTMLInputElement>(null);
  const userHasEditedRef = useRef(false);
  const [title, setTitle] = useState(() => deterministicGroupTitle(members));
  const [extraDirection, setExtraDirection] = useState("");

  const flow = useStartFlow({
    open,
    requestClose,
    pending: startGroup.isPending,
    titled: title.trim() !== "",
    focusRef: titleRef,
    send: (picks) =>
      startGroup.mutateAsync(
        buildStartGroupRequest({
          title,
          memberIds: members.map((m) => m.id),
          folder: picks.folder,
          repos: picks.repos,
          playbook: picks.playbook,
          extraDirection,
        }),
      ),
    toFailure: (refusal) => groupStartFailure(refusal, members),
    onStarted,
  });

  useEffect(() => {
    const controller = new AbortController();
    generateTitle({
      memberIds: members.map((m) => m.id),
      signal: controller.signal,
    })
      .then((result) => {
        if (!result.ok) return;
        const input = titleRef.current;
        const caret =
          input !== null && document.activeElement === input
            ? {
                selectionStart: input.selectionStart,
                selectionEnd: input.selectionEnd,
                length: input.value.length,
              }
            : null;
        if (!shouldAcceptGeneratedPhrase(userHasEditedRef.current, caret)) {
          return;
        }
        setTitle(composeGroupTitle(result.phrase, members));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("group title generation failed", err);
      });
    return () => controller.abort();
  }, [members, generateTitle]);

  return (
    <GroupStartDialog
      open={open}
      onOpenChange={onOpenChange}
      onCancel={requestClose}
      members={members}
      title={title}
      onTitleChange={(value) => {
        setTitle(value);
        userHasEditedRef.current = true;
      }}
      titleRef={titleRef}
      workspace={flow.workspace.view}
      playbook={flow.playbook.view}
      onEditPlaybooks={onEditPlaybooks}
      extraDirection={extraDirection}
      onExtraDirectionChange={setExtraDirection}
      failure={flow.failure}
      pending={startGroup.isPending}
      canStart={flow.canStart}
      onStart={() => void flow.start()}
    />
  );
}
