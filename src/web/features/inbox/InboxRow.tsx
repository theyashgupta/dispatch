import { ArrowUp } from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import {
  stampLastOpened,
  useLastOpened,
} from "../../hooks/useUnseenActivity.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Field } from "../../primitives/Field.js";
import { ListRow } from "../../primitives/ListRow.js";
import { SourceBadge } from "../badges/index.js";
import { PRIORITY_DOT } from "../board/index.js";

interface InboxRowProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: string) => void;
  onPromote: (id: string) => void;
}

export function InboxRow({
  card,
  selected,
  onSelect,
  onPromote,
}: InboxRowProps) {
  const lastOpened = useLastOpened();
  const iconOnly = useMediaQuery("(max-width: 1023px)");
  const priorityDot = PRIORITY_DOT[card.priority];

  return (
    <ListRow
      id={`inbox-row-${card.id}`}
      selected={selected}
      unread={lastOpened[card.id] == null}
      onSelect={() => {
        stampLastOpened(card.id);
        onSelect(card.id);
      }}
      leading={
        <>
          {card.source != null && <SourceBadge source={card.source} />}
          {priorityDot && (
            <span
              title={priorityDot.label}
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: priorityDot.color,
                flex: "0 0 auto",
              }}
            />
          )}
        </>
      }
      title={
        <>
          <Field
            mono
            style={{
              display: "inline-block",
              minWidth: "64px",
              marginRight: "var(--space-sm)",
            }}
          >
            {card.identifier}
          </Field>
          {card.title}
        </>
      }
      meta={
        <>
          {!iconOnly && card.project?.name ? (
            <Chip style={{ maxWidth: "140px" }}>{card.project.name}</Chip>
          ) : null}
          <span
            style={{
              flex: "0 0 56px",
              textAlign: "right",
              fontSize: "var(--font-label)",
              color: "var(--text-muted)",
            }}
          >
            {formatAge(card.updatedAt, nowMs())}
          </span>
          <Button
            variant="secondary"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onPromote(card.id);
            }}
            aria-label={iconOnly ? "Promote to To Do" : undefined}
          >
            <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />
            {!iconOnly && "Promote"}
          </Button>
        </>
      }
    />
  );
}
