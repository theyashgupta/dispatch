import { Check, ExternalLink, Play } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import type { Card } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { LinkButton } from "../../primitives/LinkButton.js";
import { Chip } from "../../primitives/Chip.js";
import { Field } from "../../primitives/Field.js";
import { ListRow } from "../../primitives/ListRow.js";
import { LinearStateChip } from "../../components/badges/index.js";
import { COLUMN_LABELS, PRIORITY_DOT } from "../board/index.js";
import { ticketActionsFor } from "./ticket-actions.js";

interface TicketRowProps {
  card: Card;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onDone: () => void;
  iconOnly: boolean;
  narrow: boolean;
}

const metaStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-xs)",
};

const priorityDotStyle: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  flex: "0 0 auto",
};

function handleStopPropagation(event: MouseEvent) {
  event.stopPropagation();
}

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
    <ListRow
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
              style={{ ...priorityDotStyle, background: priorityDot.color }}
            />
          ) : null}
        </>
      }
      title={
        <>
          <Field
            mono
            style={{
              display: "inline-block",
              marginRight: "var(--space-sm)",
            }}
          >
            {card.identifier}
          </Field>
          {card.title}
        </>
      }
      meta={
        <div style={metaStyle}>
          {!narrow && priorityDot ? (
            <Chip
              icon={
                <span
                  aria-hidden="true"
                  style={{ ...priorityDotStyle, background: priorityDot.color }}
                />
              }
            >
              {priorityDot.label}
            </Chip>
          ) : null}
          {!narrow && card.cycle != null ? (
            <Chip>{`Cycle ${card.cycle}`}</Chip>
          ) : null}
          {!narrow && card.team ? <Chip>{card.team.key}</Chip> : null}
          <Chip>{COLUMN_LABELS[card.column]}</Chip>
          {actions.includes("start") ? (
            <Button
              variant="secondary"
              aria-label={iconOnly ? "Start" : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onStart();
              }}
            >
              <Play size={12} strokeWidth={2} aria-hidden="true" />
              {!iconOnly && "Start"}
            </Button>
          ) : null}
          {actions.includes("done") ? (
            <Button
              variant="secondary"
              aria-label={iconOnly ? "Done" : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onDone();
              }}
            >
              <Check size={12} strokeWidth={2} aria-hidden="true" />
              {!iconOnly && "Done"}
            </Button>
          ) : null}
          {actions.includes("open") ? (
            <LinkButton
              href={card.url ?? ""}
              aria-label={iconOnly ? "Open in Linear" : undefined}
              onClick={handleStopPropagation}
            >
              <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
              {!iconOnly && "Open in Linear"}
            </LinkButton>
          ) : null}
        </div>
      }
    />
  );
}
