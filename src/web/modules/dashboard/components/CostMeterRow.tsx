import { TriangleAlert } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CostMeterRowProps {
  label: string;
  percent: number | null;
  text: string;
  near: boolean;
  groupLabel?: boolean;
}

export function CostMeterRow({
  label,
  percent,
  text,
  near,
  groupLabel = false,
}: CostMeterRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap">
      <span
        className={cn(
          "w-full text-sm text-foreground md:w-36 md:shrink-0",
          groupLabel && "font-mono font-semibold",
        )}
      >
        {label}
      </span>
      {percent !== null && (
        <Progress
          value={Math.min(percent, 100)}
          tone={near ? "stale" : "default"}
          aria-label={text}
          className="h-1.25 min-w-0 flex-1 basis-full rounded-sm bg-border md:basis-0"
        />
      )}
      <span className="flex items-center gap-1 text-sm text-foreground tabular-nums md:w-64 md:shrink-0">
        {near && (
          <TriangleAlert
            aria-hidden="true"
            className="size-3.5 shrink-0 text-(--status-stale)"
          />
        )}
        {text}
      </span>
    </div>
  );
}
