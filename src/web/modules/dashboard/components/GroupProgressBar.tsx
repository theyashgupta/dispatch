import { Check, Pause, X, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  NodeState,
  TrackNode,
} from "@/modules/dashboard/domain/track-nodes";

const PENDING = {
  circle: "border-dashed border-(--text-muted) bg-card text-muted-foreground",
  segment:
    "w-0 border-0 border-l-2 border-dotted border-(--text-muted) lg:h-0 lg:border-t-2 lg:border-l-0",
};

const NODES: Record<
  NodeState,
  { circle: string; line: string; segment: string; Glyph: LucideIcon | null }
> = {
  done: {
    circle: "border-(--col-agent-done) bg-(--col-agent-done) text-card",
    line: "text-(--status-ok)",
    segment: "bg-(--col-agent-done)",
    Glyph: Check,
  },
  current: {
    circle:
      "border-(--accent) bg-card shadow-glow-current motion-safe:animate-[node-breathe_var(--motion-node-breathe)_ease-in-out_infinite]",
    line: "text-(--accent-text)",
    segment:
      "bg-linear-to-b from-(--col-agent-done) to-(--accent) lg:bg-linear-to-r",
    Glyph: null,
  },
  blocked: {
    circle: "border-(--col-needs-input) bg-(--warn-soft) text-(--status-stale)",
    line: "text-(--status-stale)",
    segment: "bg-(--col-agent-done)",
    Glyph: Pause,
  },
  failed: {
    circle: "border-(--destructive) bg-(--danger-soft) text-destructive-text",
    line: "text-destructive-text",
    segment: "bg-(--col-agent-done)",
    Glyph: X,
  },
  next: {
    ...PENDING,
    line: "text-foreground",
    Glyph: null,
  },
  later: {
    ...PENDING,
    line: "text-muted-foreground",
    Glyph: null,
  },
};

interface GroupProgressBarProps {
  nodes: TrackNode[];
}

export function GroupProgressBar({ nodes }: GroupProgressBarProps) {
  return (
    <ol className="m-0 flex list-none flex-col p-0 lg:flex-row">
      {nodes.map((node, index) => {
        const { circle, line, segment, Glyph } = NODES[node.state];
        return (
          <li
            key={node.unit}
            aria-label={node.accessibleName}
            className="relative flex min-w-0 flex-1 gap-3 pb-4 last:pb-0 lg:flex-col lg:items-center lg:gap-1 lg:pb-0 lg:text-center"
          >
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -top-4 left-3.25 h-4 w-0.5 lg:top-9.5 lg:right-1/2 lg:left-auto lg:h-0.5 lg:w-full",
                  segment,
                )}
              />
            )}
            <span aria-hidden="true" className="hidden h-5 items-end lg:flex">
              {node.state === "current" && (
                <Badge tone="accent">You are here</Badge>
              )}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold tabular-nums",
                circle,
              )}
            >
              {Glyph !== null && <Glyph className="size-4" />}
              {node.state === "current" && (
                <span className="size-2.5 rounded-full bg-(--accent)" />
              )}
              {(node.state === "next" || node.state === "later") && node.unit}
            </span>
            <span
              aria-hidden="true"
              className="flex min-w-0 flex-col gap-0.5 lg:w-full lg:items-center lg:px-1"
            >
              {node.state === "current" && (
                <Badge tone="accent" className="lg:hidden">
                  You are here
                </Badge>
              )}
              <span className="line-clamp-2 text-sm font-medium wrap-anywhere text-foreground">
                {node.name}
              </span>
              <span className={cn("text-xs font-semibold tabular-nums", line)}>
                {node.stateLine}
              </span>
              {node.phase !== null && (
                <Progress
                  value={(100 * node.phase.passed) / node.phase.total}
                  tone="accent"
                  aria-hidden="true"
                  className="h-1 w-16 rounded-sm bg-border"
                />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
