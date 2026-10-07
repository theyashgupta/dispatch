import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ActivityEvent } from "../../../../shared/types.js";
import { describeEvent } from "../../../../shared/event-copy.js";
import { formatAge } from "../../../../shared/format-age.js";
import { ActivityRow } from "@/components/ActivityRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CardTimelineProps {
  cardId: string;
  events: ActivityEvent[];
  backfill: ActivityEvent[];
  identifiers?: Record<string, string>;
}

function mergeById(a: ActivityEvent[], b: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<number, ActivityEvent>();
  for (const event of a) byId.set(event.id, event);
  for (const event of b) byId.set(event.id, event);
  return [...byId.values()].sort((x, y) => y.id - x.id);
}

export function CardTimeline({
  cardId,
  events,
  backfill,
  identifiers,
}: CardTimelineProps) {
  const [expanded, setExpanded] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = mergeById(
    events.filter((event) => event.cardId === cardId),
    backfill,
  );

  return (
    <div className="flex flex-col gap-(--space-sm) border-t border-border pt-(--space-lg)">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          Activity
        </span>
        <Button
          variant="ghost"
          size="icon-md"
          className="text-muted-foreground hover:text-muted-foreground"
          aria-label="Toggle activity"
          aria-expanded={expanded}
          aria-controls="card-timeline-region"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3 transition-transform duration-(--motion-panel-close)",
              expanded
                ? "ease-(--easing-enter)"
                : "rotate-180 ease-(--easing-exit)",
            )}
          />
        </Button>
      </div>

      {expanded &&
        (rows.length === 0 ? (
          <div
            id="card-timeline-region"
            className="text-base text-muted-foreground italic"
          >
            No activity for this card yet.
          </div>
        ) : (
          <div id="card-timeline-region" className="flex flex-col">
            {rows.map((event, index) => (
              <div
                key={event.id}
                className={cn(
                  "py-(--space-sm)",
                  index < rows.length - 1 && "border-b border-border",
                )}
              >
                <ActivityRow
                  type={event.type}
                  cardId={event.cardId ?? undefined}
                  description={describeEvent(event)}
                  age={formatAge(event.ts, now)}
                  identifiers={identifiers}
                />
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
