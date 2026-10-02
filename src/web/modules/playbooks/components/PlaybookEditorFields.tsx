import type { Ref } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/ErrorAlert";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PlaybookGenerateSection,
  type PlaybookGenerateSectionProps,
} from "./PlaybookGenerateSection";

const FOOTGUN_MESSAGE =
  "Remove the text DISPATCH_STATUS: from the playbook body and try again.";

interface PlaybookEditorFieldsProps {
  name: string;
  body: string;
  nameError: string | null;
  footgunError: boolean;
  saveError: boolean;
  draftNotice: boolean;
  nameInputRef: Ref<HTMLInputElement>;
  generate: PlaybookGenerateSectionProps;
  onNameChange: (name: string) => void;
  onNameBlur: () => void;
  onBodyChange: (body: string) => void;
}

export function PlaybookEditorFields({
  name,
  body,
  nameError,
  footgunError,
  saveError,
  draftNotice,
  nameInputRef,
  generate,
  onNameChange,
  onNameBlur,
  onBodyChange,
}: PlaybookEditorFieldsProps) {
  return (
    <div className="scroll-stable-y flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
      <div className="flex flex-col gap-1">
        <Label
          htmlFor="playbook-name"
          className="text-sm font-semibold text-muted-foreground"
        >
          Name
        </Label>
        <Input
          id="playbook-name"
          ref={nameInputRef}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={onNameBlur}
          aria-label="Playbook name"
          placeholder="Playbook name"
          className="h-8 text-base md:text-base"
        />
        {nameError !== null && (
          <FieldError className="text-sm font-semibold">{nameError}</FieldError>
        )}
      </div>

      <PlaybookGenerateSection {...generate} />

      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <Label
          htmlFor="playbook-body"
          className="text-sm font-semibold text-muted-foreground"
        >
          Body
        </Label>
        {draftNotice && (
          <Alert variant="muted" role="status">
            <AlertDescription>
              Draft generated. Review and edit before saving.
            </AlertDescription>
          </Alert>
        )}
        <Textarea
          id="playbook-body"
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          aria-label="Playbook body"
          className="min-h-60 resize-y font-mono text-base md:text-base"
        />
        {footgunError && (
          <FieldError className="text-sm font-semibold">
            {FOOTGUN_MESSAGE}
          </FieldError>
        )}
      </div>

      {saveError && <ErrorAlert>Couldn't save playbook. Try again.</ErrorAlert>}
    </div>
  );
}
