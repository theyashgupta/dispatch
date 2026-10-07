import { useRef, type ComponentProps, type Ref } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderBrowserDialog } from "@/components/FolderBrowserDialog";
import { LoadingButton } from "@/components/LoadingButton";
import { PlaybookEditorFields } from "./PlaybookEditorFields";
import type { PlaybookGenerateSectionProps } from "./PlaybookGenerateSection";
import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";

interface PlaybookEditorDialogProps {
  ariaLabel: string;
  title: string;
  name: string;
  body: string;
  nameError: string | null;
  footgunError: boolean;
  saveError: boolean;
  draftNotice: boolean;
  saving: boolean;
  canSave: boolean;
  discardRef: Ref<HTMLButtonElement>;
  generate: PlaybookGenerateSectionProps;
  browser: Omit<ComponentProps<typeof FolderBrowserDialog>, "onSelect">;
  onSourceSelected: (path: string) => void;
  onNameChange: (name: string) => void;
  onNameBlur: () => void;
  onBodyChange: (body: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function PlaybookEditorDialog({
  ariaLabel,
  title,
  name,
  body,
  nameError,
  footgunError,
  saveError,
  draftNotice,
  saving,
  canSave,
  discardRef,
  generate,
  browser,
  onSourceSelected,
  onNameChange,
  onNameBlur,
  onBodyChange,
  onClose,
  onSave,
}: PlaybookEditorDialogProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(true);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={returnFocus}
        aria-label={ariaLabel}
        aria-labelledby={undefined}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInputRef.current?.focus();
        }}
        className="flex max-h-[80vh] flex-col sm:max-w-120"
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-8">{title}</DialogTitle>
        </DialogHeader>
        <PlaybookEditorFields
          name={name}
          body={body}
          nameError={nameError}
          footgunError={footgunError}
          saveError={saveError}
          draftNotice={draftNotice}
          nameInputRef={nameInputRef}
          generate={generate}
          onNameChange={onNameChange}
          onNameBlur={onNameBlur}
          onBodyChange={onBodyChange}
        />
        <DialogFooter>
          <Button
            ref={discardRef}
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
          >
            Discard changes
          </Button>
          <LoadingButton disabled={!canSave} loading={saving} onClick={onSave}>
            {saving ? "Saving playbook…" : "Save playbook"}
          </LoadingButton>
        </DialogFooter>
        <FolderBrowserDialog
          {...browser}
          onSelect={(path) => {
            onSourceSelected(path);
            browser.onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
