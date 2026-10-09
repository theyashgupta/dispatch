import { SessionStateBadge } from "@/components/badges/SessionStateBadge";
import { Badge } from "@/components/ui/badge";
import { Item, ItemContent } from "@/components/ui/item";
import type { ProgressRow } from "@/modules/dashboard/domain/progress-rows";
import { GroupProgressBar } from "./GroupProgressBar";

interface ProgressRowViewProps {
  row: ProgressRow;
}

export function ProgressRowView({ row }: ProgressRowViewProps) {
  return (
    <Item
      role="listitem"
      size="sm"
      className="flex-nowrap border-0 border-b last:border-b-0"
    >
      <ItemContent className="min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold text-foreground">
            {row.groupId}
          </span>
          {row.slug !== null && (
            <span className="text-xs text-muted-foreground">{row.slug}</span>
          )}
          {row.state !== null && <SessionStateBadge state={row.state} />}
          {row.context !== null && (
            <Badge tone="neutral" className="tabular-nums">
              {row.context}
            </Badge>
          )}
          {row.sessionTime !== null && (
            <Badge tone="neutral" className="tabular-nums">
              {row.sessionTime}
            </Badge>
          )}
          {row.timeLeft !== null && (
            <Badge tone="neutral" className="tabular-nums">
              {row.timeLeft}
            </Badge>
          )}
        </div>
        <p className="m-0 text-base text-foreground tabular-nums">
          {row.view === null ? "No loop progress" : row.view.label}
        </p>
        {row.view !== null && (
          <>
            <GroupProgressBar segments={row.view.segments} />
            {row.view.lastGateText !== null && (
              <p className="m-0 text-sm text-muted-foreground tabular-nums">
                {row.view.lastGateText}
              </p>
            )}
          </>
        )}
      </ItemContent>
    </Item>
  );
}
