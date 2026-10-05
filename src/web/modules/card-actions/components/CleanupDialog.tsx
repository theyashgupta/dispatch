import type { Card } from "../../../../shared/types.js";
import { CardConfirmDialog } from "./CardConfirmDialog";
import { cleanupPlan } from "@/modules/card-actions/domain/cleanup-plan";

export interface CleanupDialogProps {
  card: Card;
  onConfirm: (force: boolean) => void;
  onClose: () => void;
}

export function CleanupDialog({
  card,
  onConfirm,
  onClose,
}: CleanupDialogProps) {
  const plan = cleanupPlan(card);
  return (
    <CardConfirmDialog
      ariaLabel="Clean up workspace"
      identifier={card.identifier}
      keepLabel="Keep workspace"
      confirmLabel={
        plan.blocked ? "Discard uncommitted changes and clean up" : "Clean up"
      }
      destructive={plan.blocked}
      onConfirm={() => onConfirm(plan.blocked)}
      onClose={onClose}
    >
      {plan.blocked ? (
        <>
          <div className="font-semibold text-destructive-text">
            Uncommitted work would be lost
          </div>
          {plan.lines.map((line) => (
            <div key={line.key}>{line.text}</div>
          ))}
        </>
      ) : (
        plan.message
      )}
    </CardConfirmDialog>
  );
}
