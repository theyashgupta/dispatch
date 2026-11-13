import type { ClaudeUsageWindow } from "../../../../shared/types.js";
import type { UsageThresholds } from "../../../../shared/usage-thresholds.js";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  formatReset,
  PACE_BADGE,
  pacingFor,
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
  thresholds: UsageThresholds;
}

export function UsageWindowRow({
  usageWindow: w,
  pacedAt,
  thresholds,
}: UsageWindowRowProps) {
  const reset = formatReset(w.resetsAt);
  const pacing = pacedAt === null ? null : pacingFor(w, pacedAt);
  const badge = pacing ? PACE_BADGE[pacing.state] : null;
  const percent = Math.min(Math.max(w.percent, 0), 100);
  return (
    <div className="flex flex-col gap-0.5" data-window-kind={w.kind}>
      <div className="grid grid-cols-[minmax(72px,auto)_1fr_auto] items-center gap-1 text-muted-foreground">
        <span>{w.label}</span>
        <div className="relative">
          <Progress
            value={percent}
            tone={toneFor(w.percent, thresholds)}
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
      </div>
      {(reset || badge) && (
        <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
          <span>{reset ? `resets ${reset}` : ""}</span>
          {badge && (
            <Badge tone={PACE_TONE[badge.tone]} data-testid="pace-badge">
              {badge.label}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
