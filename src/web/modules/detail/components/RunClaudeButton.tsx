import { Play } from "lucide-react";
import type { Card as CardModel } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { runClaudeBlockedTitle } from "@/modules/detail/domain/pause-copy";

interface RunClaudeButtonProps {
  card: CardModel;
  onRunClaude: (id: string) => void;
}

export function RunClaudeButton({ card, onRunClaude }: RunClaudeButtonProps) {
  const blocked = runClaudeBlockedTitle(card);
  return (
    <span title={blocked ?? undefined} className="flex">
      <Button
        variant="outline"
        size="sm"
        className="h-auto min-h-8 shrink whitespace-normal"
        disabled={blocked !== null}
        aria-label={blocked ? `Run Claude. ${blocked}` : undefined}
        onClick={() => onRunClaude(card.id)}
      >
        <Play className="size-3" aria-hidden="true" />
        Run Claude
      </Button>
    </span>
  );
}
