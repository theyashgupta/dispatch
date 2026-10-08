import type { ComponentProps, ReactNode, Ref } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ModalHeader } from "./ModalHeader";

interface CardActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  title: string;
  ariaLabel?: string;
  contentRef?: Ref<HTMLDivElement>;
  className?: string;
  onOpenAutoFocus: ComponentProps<typeof DialogContent>["onOpenAutoFocus"];
  children: ReactNode;
}

export function CardActionDialog({
  open,
  onOpenChange,
  onCancel,
  title,
  ariaLabel,
  contentRef,
  className,
  onOpenAutoFocus,
  children,
}: CardActionDialogProps) {
  const label =
    ariaLabel === undefined
      ? {}
      : { "aria-label": ariaLabel, "aria-labelledby": undefined };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        frame="modal"
        aria-modal="true"
        aria-describedby={undefined}
        className={className}
        onOpenAutoFocus={onOpenAutoFocus}
        {...label}
      >
        <ModalHeader onClose={onCancel}>
          <DialogTitle className="m-0 min-w-0 font-mono leading-(--line-heading) text-foreground">
            {title}
          </DialogTitle>
        </ModalHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
