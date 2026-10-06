import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ModalActions } from "./ModalActions";
import { ModalBody } from "./ModalBody";
import { ModalHeader } from "./ModalHeader";
import { useDialogClose } from "@/components/ui/hooks/use-dialog-close";

interface CardConfirmDialogProps {
  ariaLabel: string;
  identifier: string;
  keepLabel: string;
  confirmLabel: string;
  destructive: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}

export function CardConfirmDialog({
  ariaLabel,
  identifier,
  keepLabel,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
  children,
}: CardConfirmDialogProps) {
  const { open, requestClose, onOpenChange } = useDialogClose(onClose, {
    closeOnOverlayClick: true,
  });
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        frame="modal"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={undefined}
      >
        <ModalHeader onClose={requestClose}>
          <AlertDialogTitle className="m-0 min-w-0 font-mono leading-(--line-heading) text-foreground">
            {identifier}
          </AlertDialogTitle>
        </ModalHeader>
        <ModalBody>
          <AlertDialogDescription
            asChild
            className={
              destructive
                ? "flex flex-col gap-1 text-base text-foreground"
                : "block text-base text-foreground"
            }
          >
            <div>{children}</div>
          </AlertDialogDescription>
        </ModalBody>
        <ModalActions>
          <AlertDialogCancel variant="secondary" size="sm" className="px-4">
            {keepLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            size="sm"
            className="px-4"
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </ModalActions>
      </AlertDialogContent>
    </AlertDialog>
  );
}
