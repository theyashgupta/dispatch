import type { PrRow } from "../../../../shared/pr-rows.js";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { prChips } from "@/modules/pull-requests/domain/pr-list-rows";

interface PrChipsProps {
  row: PrRow;
  className?: string;
}

export function PrChips({ row, className }: PrChipsProps) {
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {prChips(row).map((chip) => (
        <Badge key={chip.label} tone={chip.tone}>
          {chip.label}
        </Badge>
      ))}
    </span>
  );
}
