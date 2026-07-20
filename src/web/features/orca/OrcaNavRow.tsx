import { AlertTriangle, Users } from "lucide-react";
import { useState } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { useLastOpened } from "../../hooks/useUnseenActivity.js";
import { deriveShowDot } from "../../lib/card-badges.js";
import { Field } from "../../primitives/Field.js";
import { SourceBadge } from "../badges/index.js";
import {
  COLUMN_ACCENT,
  attentionTitle,
  needsAttention,
} from "../board/index.js";

interface OrcaNavRowProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: string) => void;
}

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  borderRadius: "var(--radius)",
  padding: "0 var(--space-xs)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

export function OrcaNavRow({ card, selected, onSelect }: OrcaNavRowProps) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const lastOpenedMap = useLastOpened();
  const unseen = deriveShowDot(card, selected, lastOpenedMap);
  const attention = needsAttention(card);
  const memberCount = card.memberIds?.length ?? 0;

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
      onFocus={(event) => {
        setFocused(event.currentTarget.matches(":focus-visible"));
      }}
      onBlur={() => setFocused(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-xs) var(--space-sm)",
        borderLeft: selected
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        background: hover ? "var(--surface-card-hover)" : "transparent",
        boxShadow: focused ? "0 0 0 2px var(--accent)" : "none",
        cursor: "pointer",
      }}
    >
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
      {attention ? (
        <span
          title={attentionTitle(card) ?? undefined}
          style={{ flex: "0 0 auto", display: "flex" }}
        >
          <AlertTriangle
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            style={{ color: "var(--destructive)" }}
          />
        </span>
      ) : (
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: COLUMN_ACCENT[card.column],
            flex: "0 0 auto",
          }}
        />
      )}
      {card.source === "group" ? (
        <span
          style={{
            ...chipStyle,
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          <Users size={12} strokeWidth={2} aria-hidden="true" />
          {memberCount === 1 ? "1 ticket" : `${memberCount} tickets`}
        </span>
      ) : (
        <SourceBadge source={card.source ?? "linear"} />
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
