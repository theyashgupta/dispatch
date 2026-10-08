import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BoardsError } from "./BoardsError";

interface BoardDetailDialogProps {
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

export function BoardDetailDialog({
  error,
  onRetry,
  onClose,
}: BoardDetailDialogProps) {
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
        aria-describedby={undefined}
        className="sm:max-w-160"
      >
        <DialogHeader className="text-left">
          <DialogTitle>Edit board</DialogTitle>
        </DialogHeader>
        {error === null ? (
          <>
            <span role="status" className="sr-only">
              Loading boards
            </span>
            <Skeleton aria-hidden="true" className="h-24 w-full" />
          </>
        ) : (
          <BoardsError message={error} onRetry={onRetry} />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
