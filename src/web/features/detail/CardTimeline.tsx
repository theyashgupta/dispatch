import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ActivityEvent } from "../../../shared/types.js";
import { fetchEvents } from "../../lib/api.js";
import { ActivityItem } from "../../primitives/ActivityItem.js";
import { IconButton } from "../../primitives/IconButton.js";

interface CardTimelineProps {
  cardId: string;
  events: ActivityEvent[];
}

function mergeById(a: ActivityEvent[], b: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<number, ActivityEvent>();
  for (const event of a) byId.set(event.id, event);
  for (const event of b) byId.set(event.id, event);
  return [...byId.values()].sort((x, y) => y.id - x.id);
}

export function CardTimeline({ cardId, events }: CardTimelineProps) {
  const [expanded, setExpanded] = useState(true);
  const [backfill, setBackfill] = useState<ActivityEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    setBackfill([]);
    void (async () => {
      try {
        const fetched = await fetchEvents(cardId);
        if (active) setBackfill(fetched);
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, [cardId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = mergeById(
    events.filter((event) => event.cardId === cardId),
    backfill,
  );

  return (
    <div
      style={{
        marginTop: "var(--space-lg)",
        paddingTop: "var(--space-lg)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          Activity
        </span>
        <IconButton
          aria-label="Toggle activity"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            size={12}
            strokeWidth={2}
            aria-hidden
            style={{
              transform: expanded ? "none" : "rotate(180deg)",
              transition: "transform 150ms ease-out",
            }}
          />
        </IconButton>
      </div>

      {expanded &&
        (rows.length === 0 ? (
          <div
            style={{
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              fontStyle: "italic",
              color: "var(--text-muted)",
            }}
          >
            No activity for this card yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((event, index) => (
              <div
                key={event.id}
                style={{
                  padding: "var(--space-sm) 0",
                  borderBottom:
                    index < rows.length - 1
                      ? "1px solid var(--border)"
                      : "none",
                }}
              >
                <ActivityItem event={event} now={now} />
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
