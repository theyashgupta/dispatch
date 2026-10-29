import type { ClaudeUsageWindow } from "../../../../shared/types.js";
import { Progress } from "@/components/ui/progress";
import { formatReset, toneFor } from "@/modules/accounts/domain/usage-format";

interface UsageWindowRowProps {
  usageWindow: ClaudeUsageWindow;
}

export function UsageWindowRow({ usageWindow: w }: UsageWindowRowProps) {
  const reset = formatReset(w.resetsAt);
  const percent = Math.min(Math.max(w.percent, 0), 100);
  return (
    <div
      className="grid grid-cols-[minmax(72px,auto)_1fr_auto_auto] items-center gap-1 text-muted-foreground"
      data-window-kind={w.kind}
    >
      <span>{w.label}</span>
      <Progress
        value={percent}
        tone={toneFor(w.percent)}
        aria-label={`${w.label} usage`}
        aria-valuenow={percent}
        aria-valuetext={`${w.percent}%`}
        className="h-1.25 rounded-sm bg-border"
      />
      <span className="text-foreground">{w.percent}%</span>
      <span className="text-xs text-muted-foreground">
        {reset ? `resets ${reset}` : ""}
      </span>
    </div>
  );
}
