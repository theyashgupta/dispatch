import { Badge } from "@/components/ui/badge";

interface DashboardStaleBadgeProps {
  staleText: string | null;
}

export function DashboardStaleBadge({ staleText }: DashboardStaleBadgeProps) {
  if (staleText === null) return null;
  return (
    <Badge tone="neutral" role="status">
      {staleText}
    </Badge>
  );
}
