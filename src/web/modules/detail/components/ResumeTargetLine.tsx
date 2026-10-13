import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ResumeLine } from "../domain/resume-target";

const TEXT_CLASS = "min-w-0 text-xs break-words text-muted-foreground";

export function ResumeTargetLine({ text, tooltip }: ResumeLine) {
  if (tooltip == null) {
    return <span className={TEXT_CLASS}>{text}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            TEXT_CLASS,
            "cursor-help rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-(--radix-tooltip-content-available-width)"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
