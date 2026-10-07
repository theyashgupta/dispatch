import { useRef } from "react";
import { X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDialogClose } from "@/components/ui/hooks/use-dialog-close";

interface BulkConfirmModalProps {
  verb: "Clean up" | "Resume";
  identifiers: string[];
  onConfirm: () => void;
  onClose: () => void;
}

export function BulkConfirmModal({
  verb,
  identifiers,
  onConfirm,
  onClose,
}: BulkConfirmModalProps) {
  const { open, requestClose, onOpenChange } = useDialogClose(onClose, {
    closeOnOverlayClick: true,
  });
  const firedRef = useRef(false);
  const heading = `${verb} ${identifiers.length} ${identifiers.length === 1 ? "ticket" : "tickets"}`;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        frame="modal"
        aria-modal="true"
        aria-label={heading}
        aria-labelledby={undefined}
        aria-describedby={undefined}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <AlertDialogTitle className="m-0 min-w-0 font-mono leading-(--line-heading) text-foreground">
            {heading}
          </AlertDialogTitle>
          <Button
            variant="ghost"
            size="icon-md"
            aria-label="Close"
            className="flex shrink-0 text-muted-foreground hover:text-muted-foreground"
            onClick={requestClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="reading-surface flex min-h-0 flex-auto flex-col gap-4">
          <ul
            data-testid="bulk-confirm-list"
            className="m-0 flex flex-col gap-1 pl-4 text-base text-foreground"
          >
            {identifiers.map((identifier) => (
              <li key={identifier}>
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  {identifier}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-6 pb-6">
          <AlertDialogCancel variant="secondary-bordered" size="sm">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            className="px-4"
            onClick={() => {
              if (firedRef.current) return;
              firedRef.current = true;
              onConfirm();
            }}
          >
            {verb}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
