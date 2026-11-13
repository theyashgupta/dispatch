import { TriangleAlert } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CostMeterRowProps {
  label: string;
  percent: number | null;
  text: string;
  tone: "default" | "stale" | "down";
  groupLabel?: boolean;
}

export function CostMeterRow({
  label,
  percent,
  text,
  tone,
  groupLabel = false,
}: CostMeterRowProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span
          className={cn(
            "text-sm text-foreground",
            groupLabel && "font-mono font-semibold",
          )}
        >
          {label}
        </span>
        <span className="flex items-center gap-1 text-sm text-foreground tabular-nums">
          {tone !== "default" && (
            <TriangleAlert
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0",
                tone === "down"
                  ? "text-(--status-down)"
                  : "text-(--status-stale)",
              )}
            />
          )}
          {text}
        </span>
      </div>
      {percent !== null && (
        <Progress
          value={Math.min(percent, 100)}
          tone={tone}
          aria-label={text}
          className="h-1.25 rounded-sm bg-border"
        />
      )}
    </div>
  );
}
