import { useState } from "react";
import { ArrowUp } from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { PRIORITY_DOT } from "../board/CardView.js";

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
  const [hover, setHover] = useState(false);
  const iconOnly = useMediaQuery("(max-width: 1023px)");
  const priorityDot = PRIORITY_DOT[card.priority];

  return (
    <div
      onClick={() => onSelect(card.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-lg)",
        borderBottom: "1px solid var(--border)",
        borderLeft: selected
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        background: hover ? "var(--surface-card-hover)" : "transparent",
        cursor: "pointer",
      }}
    >
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
      <Field mono style={{ flex: "0 0 auto", minWidth: "64px" }}>
        {card.identifier}
      </Field>
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          fontSize: "var(--font-body)",
          fontWeight: "var(--weight-regular)",
          lineHeight: "var(--line-body)",
          color: "var(--text)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {card.title}
      </span>
      <span
        style={{
          flex: "0 0 140px",
          minWidth: 0,
          fontSize: "var(--font-label)",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {card.project?.name ?? ""}
      </span>
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
    </div>
  );
}
