import type { SourceCardStatus } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { statusBadgeState } from "@/modules/connections/domain/status-badge";

interface StatusBadgeProps {
  status: SourceCardStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const view = statusBadgeState(status);
  if (view.tone === "danger") {
    return (
      <Badge
        tone="danger"
        className="h-auto min-h-4.5 max-w-full whitespace-normal"
      >
        {view.label}
      </Badge>
    );
  }
  return (
    <>
      <Badge tone={view.tone}>{view.label}</Badge>
      {view.account && (
        <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
          {view.account}
        </span>
      )}
    </>
  );
}
