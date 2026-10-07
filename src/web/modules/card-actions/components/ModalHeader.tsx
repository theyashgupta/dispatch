import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ModalHeaderProps {
  onClose: () => void;
  children: ReactNode;
}

export function ModalHeader({ onClose, children }: ModalHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6">
      {children}
      <Button
        variant="ghost"
        size="icon-md"
        aria-label="Close"
        className="flex shrink-0 text-muted-foreground hover:text-muted-foreground"
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
