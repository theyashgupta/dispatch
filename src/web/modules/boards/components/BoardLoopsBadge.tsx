import type { BoardCount } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { loopsLabels } from "@/modules/boards/domain/board-loops";

interface BoardLoopsBadgeProps {
  loops: BoardCount["loops"] | null;
  variant?: "badges" | "lines";
}

export function BoardLoopsBadge({
  loops,
  variant = "badges",
}: BoardLoopsBadgeProps) {
  if (loops === null) {
    return <span className="text-muted-foreground">-</span>;
  }
  const labels = loopsLabels(loops);
  if (labels === null) {
    return <span className="text-muted-foreground">0</span>;
  }
  if (variant === "lines") {
    return (
      <>
        <span className="tabular-nums xl:hidden">{loops.length}</span>
        <span className="hidden flex-col text-xs tabular-nums xl:flex">
          {labels.map((label) => (
            <span key={label} className="whitespace-nowrap">
              {label}
            </span>
          ))}
        </span>
      </>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} tone="neutral">
          {label}
        </Badge>
      ))}
    </span>
  );
}
