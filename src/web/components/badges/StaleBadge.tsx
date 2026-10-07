import { Badge } from "@/components/ui/badge";

export function StaleBadge() {
  return (
    <Badge
      tone="warning"
      title="The home login changed. Restart this session to use it."
      data-testid="session-stale-badge"
    >
      Stale login
    </Badge>
  );
}
