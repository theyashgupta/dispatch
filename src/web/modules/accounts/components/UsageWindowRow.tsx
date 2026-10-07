import type { ClaudeUsageWindow } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  formatReset,
  PACE_BADGE,
  paceTitle,
  pacingFor,
  projectionCopy,
  toneFor,
  type UsageTone,
} from "@/modules/accounts/domain/usage-format";

const PACE_TONE: Record<UsageTone, "success" | "warning" | "danger"> = {
  ok: "success",
  stale: "warning",
  down: "danger",
};

interface UsageWindowRowProps {
  usageWindow: ClaudeUsageWindow;
  pacedAt: number | null;
}

export function UsageWindowRow({
  usageWindow: w,
  pacedAt,
}: UsageWindowRowProps) {
  const reset = formatReset(w.resetsAt);
  const pacing = pacedAt === null ? null : pacingFor(w, pacedAt);
  const badge = pacing ? PACE_BADGE[pacing.state] : null;
  const title = pacing ? paceTitle(w, pacing) : undefined;
  const projection = pacing ? projectionCopy(w, pacing) : null;
  const percent = Math.min(Math.max(w.percent, 0), 100);
  return (
    <div className="flex flex-col gap-1" data-window-kind={w.kind}>
      <div
        className="grid grid-cols-[minmax(72px,auto)_1fr_auto_auto] items-center gap-1 text-muted-foreground"
        title={title}
      >
        <span>{w.label}</span>
        <div className="relative">
          <Progress
            value={percent}
            tone={toneFor(w.percent)}
            aria-label={`${w.label} usage`}
            aria-valuenow={percent}
            aria-valuetext={`${w.percent}%`}
            className="h-1.25 rounded-sm bg-border"
          />
          {pacing && (
            <Progress
              value={Math.min(pacing.percentElapsed, 100)}
              tone="marker"
              aria-hidden="true"
              data-testid="pace-elapsed-marker"
              className="absolute inset-0 h-auto rounded-sm bg-transparent"
            />
          )}
        </div>
        <span className="text-foreground">{w.percent}%</span>
        <span className="text-xs text-muted-foreground">
          {reset ? `resets ${reset}` : ""}
        </span>
      </div>
      {badge && (
        <div className="flex flex-wrap items-center gap-1">
          <Badge
            tone={PACE_TONE[badge.tone]}
            data-testid="pace-badge"
            title={title}
          >
            {badge.label}
          </Badge>
          {projection && (
            <span
              data-testid="pace-projection"
              className="text-xs text-muted-foreground"
            >
              {projection}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
