import type { RefObject } from "react";
import type { Card } from "../../../../shared/types.js";
import { MemberRow } from "@/components/MemberRow";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CardActionDialog } from "./CardActionDialog";
import { ModalActions } from "./ModalActions";
import { ModalBody } from "./ModalBody";
import {
  PlaybookPickerSection,
  type PlaybookPickerModel,
} from "./PlaybookPickerSection";
import { StartFailureNotice } from "./StartFailureNotice";
import { StartPromptField } from "./StartPromptField";
import { ModalFieldLabel } from "./ModalFieldLabel";
import {
  WorkspacePickerSection,
  type WorkspacePickerModel,
} from "./WorkspacePickerSection";
import type { StartFailure } from "@/modules/card-actions/domain/start-copy";

interface GroupStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  members: Card[];
  title: string;
  onTitleChange: (value: string) => void;
  titleRef: RefObject<HTMLInputElement | null>;
  workspace: WorkspacePickerModel;
  playbook: PlaybookPickerModel;
  onEditPlaybooks: () => void;
  extraDirection: string;
  onExtraDirectionChange: (value: string) => void;
  failure: StartFailure | null;
  pending: boolean;
  canStart: boolean;
  onStart: () => void;
}

export function GroupStartDialog({
  open,
  onOpenChange,
  onCancel,
  members,
  title,
  onTitleChange,
  titleRef,
  workspace,
  playbook,
  onEditPlaybooks,
  extraDirection,
  onExtraDirectionChange,
  failure,
  pending,
  canStart,
  onStart,
}: GroupStartDialogProps) {
  return (
    <CardActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onCancel={onCancel}
      title="New group"
      ariaLabel="New group"
      className="max-h-[80vh]"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
    >
      <ModalBody>
        <Field className="gap-1">
          <ModalFieldLabel htmlFor="group-start-title">Title</ModalFieldLabel>
          <Input
            id="group-start-title"
            ref={titleRef}
            value={title}
            maxLength={300}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-label="Title"
            variant="surface"
            className="h-8 px-2 py-0 text-base md:text-base"
          />
        </Field>
        <WorkspacePickerSection workspace={workspace} />
        <PlaybookPickerSection
          playbook={playbook}
          onEditPlaybooks={onEditPlaybooks}
        />
        <Field className="gap-1">
          <ModalFieldLabel className="font-medium">
            {`Members (${members.length})`}
          </ModalFieldLabel>
          {members.map((member) => (
            <MemberRow key={member.id} member={member} actionable={true} />
          ))}
        </Field>
        <StartPromptField
          value={extraDirection}
          onChange={onExtraDirectionChange}
          placeholder="Optional direction for Claude. Applies to the whole group. Press Start to launch."
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
          {pending ? "Starting group…" : "Start group"}
        </Button>
      </ModalActions>
    </CardActionDialog>
  );
}
