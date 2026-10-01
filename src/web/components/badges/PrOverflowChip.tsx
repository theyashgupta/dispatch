import { Badge } from "@/components/ui/badge";

export const PR_CHIP_CAP = 3;

export function PrOverflowChip({ hidden }: { hidden: number }) {
  const label = `${hidden} more pull request${hidden === 1 ? "" : "s"}`;
  return (
    <Badge
      tone="neutral"
      className="h-auto text-sm"
      title={label}
      aria-label={label}
    >
      {`+${hidden}`}
    </Badge>
  );
}
