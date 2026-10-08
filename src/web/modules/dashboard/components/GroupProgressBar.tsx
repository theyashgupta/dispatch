import { Check, Circle, Play, X, type LucideIcon } from "lucide-react";
import type {
  LoopSegment,
  SegmentState,
} from "../../../../shared/loop-view.js";
import { cn } from "@/lib/utils";

const SEGMENTS: Record<SegmentState, { Glyph: LucideIcon; fill: string }> = {
  done: { Glyph: Check, fill: "border-(--text-muted) bg-(--text-muted)" },
  current: { Glyph: Play, fill: "segment-stripes border-(--text)" },
  pending: { Glyph: Circle, fill: "border-(--text-muted)" },
  "failed gate": { Glyph: X, fill: "segment-dots border-(--destructive)" },
};

const LEGEND_ORDER: SegmentState[] = [
  "done",
  "current",
  "pending",
  "failed gate",
];

interface GroupProgressBarProps {
  segments: LoopSegment[];
}

export function GroupProgressBar({ segments }: GroupProgressBarProps) {
  return (
    <ul className="m-0 flex list-none gap-1 p-0">
      {segments.map((segment) => {
        const { Glyph, fill } = SEGMENTS[segment.state];
        return (
          <li
            key={segment.unit}
            aria-label={segment.accessibleName}
            className="flex min-w-0 flex-1 flex-col gap-1"
          >
            <span
              aria-hidden="true"
              className={cn("block h-2 rounded-full border", fill)}
            />
            <span className="flex flex-wrap items-center gap-x-1 text-xs text-foreground">
              <Glyph aria-hidden="true" className="size-3 shrink-0" />
              Unit {segment.unit}
              <span className="text-muted-foreground">{segment.state}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SegmentLegend() {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-foreground">
      {LEGEND_ORDER.map((state) => {
        const { Glyph, fill } = SEGMENTS[state];
        return (
          <li key={state} className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className={cn("block h-2 w-6 rounded-full border", fill)}
            />
            <Glyph aria-hidden="true" className="size-3 shrink-0" />
            {state}
          </li>
        );
      })}
    </ul>
  );
}
