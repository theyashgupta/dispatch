import type { Ref } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GenerateFailedAlert } from "./GenerateFailedAlert";
import { ModalFieldLabel } from "./ModalFieldLabel";

interface TicketReviewFieldsProps {
  title: string;
  description: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  titleRef: Ref<HTMLInputElement>;
  draftNotice: boolean;
  editedSinceGenerate: boolean;
  generateFailed: boolean;
  acceptError: string | null;
}

export function TicketReviewFields({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  titleRef,
  draftNotice,
  editedSinceGenerate,
  generateFailed,
  acceptError,
}: TicketReviewFieldsProps) {
  return (
    <>
      {draftNotice && (
        <div className="mt-1 truncate text-sm text-muted-foreground">
          Generated. Review and edit before accepting.
        </div>
      )}
      <Field className="gap-1">
        <ModalFieldLabel htmlFor="create-ticket-title">Title</ModalFieldLabel>
        <Input
          id="create-ticket-title"
          ref={titleRef}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          aria-label="Title"
          variant="surface"
          className="h-8 px-2 py-0 text-base md:text-base"
        />
      </Field>
      <Field className="gap-1">
        <ModalFieldLabel htmlFor="create-ticket-description">
          Description
        </ModalFieldLabel>
        <Textarea
          id="create-ticket-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          aria-label="Description"
          variant="surface"
          className="field-sizing-fixed min-h-60 resize-y p-2 text-base md:text-base"
        />
      </Field>
      {editedSinceGenerate && (
        <div className="truncate text-sm text-muted-foreground">
          Regenerating replaces your current edits.
        </div>
      )}
      {generateFailed && <GenerateFailedAlert />}
      {acceptError !== null && (
        <Alert variant="destructive">
          <AlertDescription className="text-base font-normal">
            {acceptError}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
