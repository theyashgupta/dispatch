import type { RefObject } from "react";
import type { Card } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CardActionDialog } from "./CardActionDialog";
import { InheritToggleSection } from "./InheritToggleSection";
import { ModalActions } from "./ModalActions";
import { ModalBody } from "./ModalBody";
import {
  PlaybookPickerSection,
  type PlaybookPickerModel,
} from "./PlaybookPickerSection";
import { StartFailureNotice } from "./StartFailureNotice";
import { StartPromptField } from "./StartPromptField";
import {
  WorkspacePickerSection,
  type WorkspacePickerModel,
} from "./WorkspacePickerSection";
import type { StartFailure } from "@/modules/card-actions/domain/start-copy";

interface StartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  card: Card;
  newSession: boolean;
  inherit: boolean;
  onInheritChange: (inherit: boolean) => void;
  workspace: WorkspacePickerModel;
  playbook: PlaybookPickerModel;
  onEditPlaybooks: () => void;
  extraDirection: string;
  onExtraDirectionChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  failure: StartFailure | null;
  pending: boolean;
  canStart: boolean;
  onStart: () => void;
}

export function StartDialog({
  open,
  onOpenChange,
  onCancel,
  card,
  newSession,
  inherit,
  onInheritChange,
  workspace,
  playbook,
  onEditPlaybooks,
  extraDirection,
  onExtraDirectionChange,
  textareaRef,
  failure,
  pending,
  canStart,
  onStart,
}: StartDialogProps) {
  return (
    <CardActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onCancel={onCancel}
      title={card.identifier}
      ariaLabel="Start session"
      className="max-h-[80vh]"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        textareaRef.current?.focus();
      }}
    >
      <ModalBody>
        <WorkspacePickerSection workspace={workspace} />
        {newSession && (
          <InheritToggleSection
            card={card}
            inherit={inherit}
            onChange={onInheritChange}
          />
        )}
        <PlaybookPickerSection
          playbook={playbook}
          onEditPlaybooks={onEditPlaybooks}
        />
        <StartPromptField
          textareaRef={textareaRef}
          value={extraDirection}
          onChange={onExtraDirectionChange}
          placeholder="Optional direction for Claude. Press Start to launch"
        />
        {failure !== null && <StartFailureNotice failure={failure} />}
      </ModalBody>
      <ModalActions>
        <Button
          size="sm"
          className="px-4"
          disabled={!canStart}
          aria-busy={pending ? true : undefined}
          onClick={onStart}
        >
          {pending && <Spinner aria-hidden="true" />}
          {pending ? "Starting…" : "Start"}
        </Button>
      </ModalActions>
    </CardActionDialog>
  );
}
