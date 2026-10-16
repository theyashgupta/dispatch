import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SplitButtonProps {
  available: boolean;
  onSplit: () => void;
}

export function SplitButton({ available, onSplit }: SplitButtonProps) {
  const reasonId = useId();
  if (available) {
    return (
      <Button variant="outline" size="sm" onClick={onSplit}>
        Split
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          <Button
            variant="outline"
            size="sm"
            disabled
            aria-describedby={reasonId}
          >
            Split
          </Button>
          <span id={reasonId} className="sr-only">
            No other board to open
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>No other board to open</TooltipContent>
    </Tooltip>
  );
}
