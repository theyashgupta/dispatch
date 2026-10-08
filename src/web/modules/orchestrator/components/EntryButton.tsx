import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EntryModel } from "@/modules/orchestrator/domain/entry-model";
import { ENTRY_BUTTON_ID } from "@/modules/orchestrator/hooks/focus-entry";

interface EntryButtonProps {
  entry: EntryModel;
  onOpen: () => void;
}

export function EntryButton({ entry, onOpen }: EntryButtonProps) {
  const button = (
    <Button
      id={ENTRY_BUTTON_ID}
      variant="outline"
      size="sm"
      aria-label={entry.label}
      onClick={onOpen}
    >
      {entry.hasOrchestrator ? (
        "Orchestrator"
      ) : (
        <>
          <Plus aria-hidden="true" className="md:hidden" />
          <span className="md:hidden">Orchestrator</span>
          <span className="hidden md:inline">Add orchestrator</span>
        </>
      )}
    </Button>
  );
  if (entry.tooltip === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{entry.tooltip}</TooltipContent>
    </Tooltip>
  );
}
