import { Plus } from "lucide-react";
import type { Card as CardModel } from "../../../../shared/types.js";
import type { StartRequest } from "../../../../shared/start-request.js";
import { Button } from "@/components/ui/button";

interface StartAnotherSessionButtonProps {
  card: CardModel;
  onStartRequest?: (req: string | StartRequest) => void;
  narrowPanel: boolean;
}

export function StartAnotherSessionButton({
  card,
  onStartRequest,
  narrowPanel,
}: StartAnotherSessionButtonProps) {
  const inFlight = card.provisioningStep != null;
  const label = inFlight ? "Starting…" : "Start another session";
  const reason = inFlight
    ? "Starting another session…"
    : narrowPanel
      ? "Start another session"
      : undefined;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={inFlight}
      onClick={() => onStartRequest?.({ cardId: card.id, newSession: true })}
      aria-label={reason}
      title={reason}
    >
      <Plus className="size-3" aria-hidden="true" />
      {!narrowPanel && label}
    </Button>
  );
}
