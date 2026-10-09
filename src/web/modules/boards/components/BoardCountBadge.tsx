import { Badge } from "@/components/ui/badge";
import {
  countLabel,
  type CountKind,
} from "@/modules/boards/domain/board-counts";

interface BoardCountBadgeProps {
  kind: CountKind;
  count: number | null;
}

export function BoardCountBadge({ kind, count }: BoardCountBadgeProps) {
  if (count === null) {
    return <span className="text-muted-foreground">-</span>;
  }
  const label = countLabel(kind, count);
  if (label === null) {
    return <span className="text-muted-foreground">0</span>;
  }
  return (
    <Badge tone="neutral" title={label} className="overflow-visible">
      {label}
    </Badge>
  );
}
