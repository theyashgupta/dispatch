import type { ReactNode, RefObject } from "react";
import { LoadingButton } from "@/components/LoadingButton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";

export type NotesPhase = "paste" | "generating" | "review";

interface MeetingNotesDialogProps {
  phase: NotesPhase;
  canDraft: boolean;
  canCreate: boolean;
  creating: boolean;
  hasRows: boolean;
  checkedCount: number;
  initialFocusRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onDraft: () => void;
  onCancel: () => void;
  onBack: () => void;
  onCreate: () => void;
  children: ReactNode;
}

const TITLE = "New tickets from meeting notes";

export function MeetingNotesDialog({
  phase,
  canDraft,
  canCreate,
  creating,
  hasRows,
  checkedCount,
  initialFocusRef,
  onClose,
  onDraft,
  onCancel,
  onBack,
  onCreate,
  children,
}: MeetingNotesDialogProps) {
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
        aria-label={TITLE}
        aria-labelledby={undefined}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          initialFocusRef.current?.focus();
        }}
        className="flex max-h-[85vh] flex-col sm:max-w-180"
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-8">{TITLE}</DialogTitle>
        </DialogHeader>
        <div className="scroll-stable-y -mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          {children}
        </div>
        <DialogFooter>
          {phase === "paste" && (
            <LoadingButton disabled={!canDraft} onClick={onDraft}>
              Draft action items
            </LoadingButton>
          )}
          {phase === "generating" && (
            <LoadingButton variant="secondary" onClick={onCancel}>
              Cancel
            </LoadingButton>
          )}
          {phase === "review" && (
            <>
              <LoadingButton
                variant="secondary"
                disabled={creating}
                onClick={onBack}
              >
                Back
              </LoadingButton>
              {hasRows && (
                <LoadingButton
                  disabled={!canCreate}
                  loading={creating}
                  onClick={onCreate}
                >
                  {checkedCount === 1
                    ? "Create 1 item"
                    : `Create ${checkedCount} items`}
                </LoadingButton>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
