import { Badge } from "@/components/ui/badge";

interface BlockedByChipProps {
  label: string;
  title?: string;
}

export function BlockedByChip({ label, title }: BlockedByChipProps) {
  return (
    <Badge tone="warning" title={title} className="max-w-full min-w-0">
      <span className="min-w-0 truncate">{`Blocked by ${label}`}</span>
    </Badge>
  );
}
