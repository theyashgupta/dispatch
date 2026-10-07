import { TriangleAlert, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { noticeLabel } from "@/modules/board/domain/failed-move-notice";

interface FailedMoveAlertProps {
  count: number;
  onDismiss: () => void;
}

export function FailedMoveAlert({ count, onDismiss }: FailedMoveAlertProps) {
  return (
    <Alert className="fixed top-(--space-lg) right-(--space-lg) z-20 flex w-auto items-center gap-(--space-sm) rounded-md border-border bg-card px-(--space-lg) py-(--space-sm) shadow-(--shadow-float)">
      <span className="flex items-center gap-(--space-xs) text-sm font-semibold text-destructive-text">
        <TriangleAlert className="size-3.5" aria-hidden="true" />
        {noticeLabel(count)}
      </span>
      <Button
        variant="ghost"
        size="icon-md"
        aria-label="Dismiss the failed move notice"
        onClick={onDismiss}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </Alert>
  );
}
