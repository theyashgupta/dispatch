import type { Card } from "../../../../shared/types.js";
import { CardConfirmDialog } from "./CardConfirmDialog";
import { resetItems } from "@/modules/card-actions/domain/reset-items";

export interface ResetDialogProps {
  card: Card;
  onConfirm: () => void;
  onClose: () => void;
}

export function ResetDialog({ card, onConfirm, onClose }: ResetDialogProps) {
  return (
    <CardConfirmDialog
      ariaLabel="Reset ticket"
      identifier={card.identifier}
      keepLabel="Keep everything"
      confirmLabel="Reset to Inbox"
      destructive
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <div className="font-semibold text-destructive-text">Reset deletes</div>
      {resetItems(card).map((item) => (
        <div key={item}>{item}</div>
      ))}
      <div className="text-muted-foreground">
        Uncommitted changes are lost. Pushed branches and open PRs are not
        touched. The ticket returns to the Inbox as if never started.
      </div>
    </CardConfirmDialog>
  );
}
