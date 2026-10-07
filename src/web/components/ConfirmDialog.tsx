import { useEffect, useRef } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";

interface ConfirmDialogProps {
  label: string;
  title: string;
  titleClassName?: string;
  description: string;
  descriptionClassName?: string;
  error?: string | null;
  cancelLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  confirmVariant?: "default" | "destructive";
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  label,
  title,
  titleClassName,
  description,
  descriptionClassName,
  error,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  confirmVariant = "default",
  pending,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const returnFocus = useReturnFocus(true);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const keepFocus = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-slot="alert-dialog-overlay"]')
      ) {
        event.preventDefault();
      }
    };
    document.addEventListener("mousedown", keepFocus, true);
    return () => document.removeEventListener("mousedown", keepFocus, true);
  }, []);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={returnFocus}
        aria-label={label}
        aria-labelledby={undefined}
      >
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className={titleClassName}>
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className={descriptionClassName}>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} variant="secondary" size="sm">
            {cancelLabel}
          </AlertDialogCancel>
          <LoadingButton
            variant={confirmVariant}
            loading={pending}
            onClick={() => {
              cancelRef.current?.focus();
              onConfirm();
            }}
          >
            {pending ? pendingLabel : confirmLabel}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
