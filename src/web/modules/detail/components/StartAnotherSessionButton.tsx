import { Plus } from "lucide-react";
import type { Card as CardModel } from "../../../../shared/types.js";
import type { StartRequest } from "../../../../shared/start-request.js";
import { Button } from "@/components/ui/button";
import { runClaudeBlockedTitle } from "@/modules/detail/domain/pause-copy";

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
  const blocked = runClaudeBlockedTitle(card);
  const label = inFlight ? "Starting…" : "Start another session";
  const reason = inFlight
    ? "Starting another session…"
    : narrowPanel
      ? "Start another session"
      : undefined;

  return (
    <span title={blocked ?? undefined} className="flex">
      <Button
        variant="outline"
        size="sm"
        disabled={inFlight || blocked !== null}
        onClick={() => onStartRequest?.({ cardId: card.id, newSession: true })}
        aria-label={blocked ? `Start another session. ${blocked}` : reason}
        title={blocked ?? reason}
      >
        <Plus className="size-3" aria-hidden="true" />
        {!narrowPanel && label}
      </Button>
    </span>
  );
}
