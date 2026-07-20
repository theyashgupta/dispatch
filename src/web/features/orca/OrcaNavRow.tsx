import { useState } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { isUnseen, useLastOpened } from "../../hooks/useUnseenActivity.js";
import { Field } from "../../primitives/Field.js";
import { COLUMN_ACCENT } from "../board/index.js";

interface OrcaNavRowProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function OrcaNavRow({ card, selected, onSelect }: OrcaNavRowProps) {
  const [hover, setHover] = useState(false);
  const lastOpenedMap = useLastOpened();
  const unseen = isUnseen(card.outputChangedAt, lastOpenedMap[card.id]);

  function select() {
    onSelect(card.id);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          select();
        } else if (event.key === " ") {
          event.preventDefault();
          select();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-xs) var(--space-sm)",
        borderLeft: selected
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        background: hover ? "var(--surface-card-hover)" : "transparent",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: COLUMN_ACCENT[card.column],
          flex: "0 0 auto",
        }}
      />
      <Field mono style={{ flex: "0 0 auto" }}>
        {card.identifier}
      </Field>
      <span
        title={card.title}
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
      {card.source === "group" && (
        <span
          style={{
            flex: "0 0 auto",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-regular)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          {(card.memberIds?.length ?? 0) === 1
            ? "1 ticket"
            : `${card.memberIds?.length ?? 0} tickets`}
        </span>
      )}
      {unseen && (
        <span
          aria-hidden="true"
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "var(--status-ok)",
            flex: "0 0 auto",
          }}
        />
      )}
    </div>
  );
}
