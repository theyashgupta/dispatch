import { Plus } from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import type { StartRequest } from "../../lib/start-request.js";
import { Button } from "../../primitives/Button.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";

interface StartAnotherSessionButtonProps {
  card: CardModel;
  onStartRequest?: (req: string | StartRequest) => void;
  docked?: boolean;
  takeover?: boolean;
}

export function StartAnotherSessionButton({
  card,
  onStartRequest,
  docked = false,
  takeover = false,
}: StartAnotherSessionButtonProps) {
  const narrowViewport = useMediaQuery("(max-width: 520px)");
  const narrowPanel = (docked || takeover) && narrowViewport;

  if (
    card.column === "done" ||
    card.groupId != null ||
    card.workspacePath == null
  ) {
    return null;
  }

  const inFlight = card.provisioningStep != null;
  const label = inFlight ? "Starting…" : "Start another session";
  const reason = inFlight
    ? "Starting another session…"
    : narrowPanel
      ? "Start another session"
      : undefined;

  return (
    <Button
      variant="secondary"
      disabled={inFlight}
      onClick={() => onStartRequest?.({ cardId: card.id, newSession: true })}
      aria-label={reason}
      title={reason}
    >
      <Plus size={12} strokeWidth={2} aria-hidden="true" />
      {!narrowPanel && label}
    </Button>
  );
}
