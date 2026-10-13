import { SessionStateBadge } from "@/components/badges/SessionStateBadge";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProgressRow } from "@/modules/dashboard/domain/progress-rows";
import { GroupProgressBar } from "./GroupProgressBar";

interface ProgressRowViewProps {
  row: ProgressRow;
}

export function ProgressRowView({ row }: ProgressRowViewProps) {
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-(--space-md) rounded-(--radius) p-(--space-lg)",
        cardVariants({ surface: "rest" }),
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-foreground">
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
        <span className="text-sm text-muted-foreground tabular-nums lg:ms-auto">
          {row.view === null ? "No loop progress" : row.view.label}
        </span>
      </div>
      {row.track !== null && row.track.length > 0 && (
        <GroupProgressBar nodes={row.track} />
      )}
      {row.view?.lastGateText != null && (
        <p className="m-0 text-sm text-muted-foreground tabular-nums">
          {row.view.lastGateText}
        </p>
      )}
    </li>
  );
}
