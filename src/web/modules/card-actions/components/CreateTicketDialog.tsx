import { useRef, type Ref } from "react";
import { MAX_ATTACHMENTS } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { CardActionDialog } from "./CardActionDialog";
import { GenerateFailedAlert } from "./GenerateFailedAlert";
import { ModalActions } from "./ModalActions";
import { ModalBody } from "./ModalBody";
import { ModalFieldLabel } from "./ModalFieldLabel";
import { PastedImageStrip } from "./PastedImageStrip";
import { TicketReviewFields } from "./TicketReviewFields";

export type TicketPhase = "prompt" | "generating" | "review";

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  phase: TicketPhase;
  prompt: string;
  onPromptChange: (value: string) => void;
  onPaste: (items: DataTransferItemList | null) => void;
  images: { id: string; url: string }[];
  limitHit: boolean;
  onRemoveImage: (id: string) => void;
  generateFailed: boolean;
  title: string;
  description: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  titleRef: Ref<HTMLInputElement>;
  draftNotice: boolean;
  editedSinceGenerate: boolean;
  acceptError: string | null;
  accepting: boolean;
  canGenerate: boolean;
  canAccept: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
  onCancelGenerate: () => void;
  onAccept: () => void;
  onFromMeetingNotes: () => void;
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  onCancel,
  phase,
  prompt,
  onPromptChange,
  onPaste,
  images,
  limitHit,
  onRemoveImage,
  generateFailed,
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  titleRef,
  draftNotice,
  editedSinceGenerate,
  acceptError,
  accepting,
  canGenerate,
  canAccept,
  onGenerate,
  onRegenerate,
  onCancelGenerate,
  onAccept,
  onFromMeetingNotes,
}: CreateTicketDialogProps) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const generating = phase === "generating";
  return (
    <CardActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onCancel={onCancel}
      title="New ticket"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        promptRef.current?.focus();
      }}
    >
      <ModalBody>
        <div className="flex flex-col gap-4">
          {phase !== "review" && (
            <Field className="gap-1">
              <ModalFieldLabel htmlFor="create-ticket-prompt">
                What do you want to build or fix?
              </ModalFieldLabel>
              <Textarea
                id="create-ticket-prompt"
                ref={promptRef}
                value={prompt}
                disabled={generating}
                onChange={(e) => onPromptChange(e.target.value)}
                onPaste={(e) => onPaste(e.clipboardData?.items ?? null)}
                aria-label="What do you want to build or fix?"
                placeholder="Describe the ticket in as much detail as you can. Claude will draft the title and description."
                variant="surface"
                className="field-sizing-fixed min-h-40 resize-y p-2 text-base md:text-base"
              />
            </Field>
          )}
          {images.length > 0 && (
            <PastedImageStrip
              images={images}
              disabled={generating || accepting}
              onRemove={onRemoveImage}
            />
          )}
          {limitHit && (
            <div className="truncate text-sm text-muted-foreground">
              You can attach up to {MAX_ATTACHMENTS} images.
            </div>
          )}
          {generating && (
            <span className="text-base text-muted-foreground">
              Drafting your ticket. This can take up to a couple of minutes.
            </span>
          )}
          {phase !== "review" && generateFailed && <GenerateFailedAlert />}
          {phase === "review" && (
            <TicketReviewFields
              title={title}
              description={description}
              onTitleChange={onTitleChange}
              onDescriptionChange={onDescriptionChange}
              titleRef={titleRef}
              draftNotice={draftNotice}
              editedSinceGenerate={editedSinceGenerate}
              generateFailed={generateFailed}
              acceptError={acceptError}
            />
          )}
        </div>
      </ModalBody>
      <ModalActions>
        {phase === "prompt" && (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="mr-auto px-2"
              onClick={onFromMeetingNotes}
            >
              From meeting notes
            </Button>
            <Button
              size="sm"
              className="px-4"
              disabled={!canGenerate}
              onClick={onGenerate}
            >
              Generate ticket
            </Button>
          </>
        )}
        {generating && (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="px-2"
              onClick={onCancelGenerate}
            >
              Cancel
            </Button>
            <Button size="sm" className="px-4" disabled aria-busy="true">
              Generating…
            </Button>
          </>
        )}
        {phase === "review" && (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="px-2"
              disabled={accepting}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="px-2"
              disabled={accepting}
              onClick={onRegenerate}
            >
              Regenerate
            </Button>
            <Button
              size="sm"
              className="px-4"
              disabled={!canAccept}
              aria-busy={accepting ? true : undefined}
              onClick={onAccept}
            >
              {accepting && <Spinner aria-hidden="true" />}
              {accepting ? "Creating ticket…" : "Accept ticket"}
            </Button>
          </>
        )}
      </ModalActions>
    </CardActionDialog>
  );
}
