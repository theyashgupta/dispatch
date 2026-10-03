import { Check, ExternalLink, Play } from "lucide-react";
import type { Card } from "../../../../shared/types.js";
import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import { LinearStateChip } from "@/components/badges";
import { ListItemRow } from "@/components/ListItemRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withoutBubbling } from "@/components/without-bubbling";
import { ticketActionsFor } from "@/modules/tickets/domain/ticket-actions";

interface TicketRowProps {
  card: Card;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onDone: () => void;
  iconOnly: boolean;
  narrow: boolean;
}

const PRIORITY_DOT: Record<number, { dot: string; label: string }> = {
  1: { dot: "bg-(--prio-urgent)", label: "Urgent priority" },
  2: { dot: "bg-(--prio-high)", label: "High priority" },
  3: { dot: "bg-(--prio-medium)", label: "Medium priority" },
  4: { dot: "bg-(--prio-low)", label: "Low priority" },
};

export function TicketRow({
  card,
  selected,
  onSelect,
  onStart,
  onDone,
  iconOnly,
  narrow,
}: TicketRowProps) {
  const actions = ticketActionsFor(card);
  const priorityDot = PRIORITY_DOT[card.priority];

  return (
    <ListItemRow
      id={`ticket-row-${card.id}`}
      selected={selected}
      unread={false}
      onSelect={onSelect}
      leading={
        <>
          <LinearStateChip card={card} />
          {narrow && priorityDot ? (
            <span
              role="img"
              aria-label={priorityDot.label}
              title={priorityDot.label}
              className={`size-1.5 shrink-0 rounded-full ${priorityDot.dot}`}
            />
          ) : null}
        </>
      }
      title={
        <>
          <span className="mr-2 inline-block font-mono text-xs font-semibold text-muted-foreground">
            {card.identifier}
          </span>
          {card.title}
        </>
      }
      metaClassName="flex-wrap gap-1"
      meta={
        <>
          {!narrow && priorityDot ? (
            <Badge tone="neutral">
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${priorityDot.dot}`}
              />
              {priorityDot.label}
            </Badge>
          ) : null}
          {!narrow && card.cycle != null ? (
            <Badge tone="neutral">{`Cycle ${card.cycle}`}</Badge>
          ) : null}
          {!narrow && card.team ? (
            <Badge tone="neutral">{card.team.key}</Badge>
          ) : null}
          <Badge tone="neutral">
            {COLUMN_LABELS[card.column].toUpperCase()}
          </Badge>
          {actions.includes("start") ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={iconOnly ? "Start" : undefined}
              onClick={withoutBubbling(onStart)}
            >
              <Play aria-hidden="true" className="size-3" strokeWidth={2} />
              {!iconOnly && "Start"}
            </Button>
          ) : null}
          {actions.includes("done") ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={iconOnly ? "Done" : undefined}
              onClick={withoutBubbling(onDone)}
            >
              <Check aria-hidden="true" className="size-3" strokeWidth={2} />
              {!iconOnly && "Done"}
            </Button>
          ) : null}
          {actions.includes("open") ? (
            <Button
              asChild
              variant="secondary"
              size="sm"
              aria-label={iconOnly ? "Open in Linear" : undefined}
            >
              <a
                href={card.url ?? ""}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLink
                  aria-hidden="true"
                  className="size-3"
                  strokeWidth={2}
                />
                {!iconOnly && "Open in Linear"}
              </a>
            </Button>
          ) : null}
        </>
      }
    />
  );
}
