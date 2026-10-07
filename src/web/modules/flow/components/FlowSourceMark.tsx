import { createElement } from "react";
import { sourceAccent, sourceMark } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FlowSourceMarkProps {
  source: string;
  size: 12 | 16;
}

export function FlowSourceMark({ source, size }: FlowSourceMarkProps) {
  return (
    <Badge
      variant="ghost"
      stateColor={sourceAccent(source)}
      className={cn(
        "h-auto w-auto flex-none gap-0 overflow-visible rounded-none border-0 p-0 text-(--badge-state)",
        size === 16 ? "[&>svg]:size-4" : "[&>svg]:size-3",
      )}
    >
      {createElement(sourceMark(source), { size })}
    </Badge>
  );
}
