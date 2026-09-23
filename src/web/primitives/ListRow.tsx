import {
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { focusRing } from "./focus-ring.js";

interface ListRowProps {
  id?: string;
  leading?: ReactNode;
  title: ReactNode;
  snippet?: string;
  meta?: ReactNode;
  selected: boolean;
  unread: boolean;
  onSelect: () => void;
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) var(--space-lg)",
  borderWidth: "1px",
  borderStyle: "solid",
  cursor: "pointer",
  outline: "none",
  transition: "var(--hover-transition)",
};

const leadingStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  flex: "0 0 auto",
};

const bodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const titleStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const snippetStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const dotStyle: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: "var(--accent)",
  flex: "0 0 auto",
};

const metaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  flex: "0 0 auto",
};

export function ListRow({
  id,
  leading,
  title,
  snippet,
  meta,
  selected,
  unread,
  onSelect,
}: ListRowProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.repeat) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  }

  return (
    <div
      id={id}
      role="listitem"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{
        ...rowStyle,
        background: selected
          ? "var(--surface-card)"
          : hovered
            ? "var(--surface-card-hover)"
            : "transparent",
        borderColor: selected
          ? "var(--accent)"
          : "transparent transparent var(--border)",
        boxShadow: selected ? "inset 0 0 0 1px var(--accent)" : "none",
        ...focusRing(focused, true),
      }}
    >
      {leading ? <span style={leadingStyle}>{leading}</span> : null}
      <span style={bodyStyle}>
        <span
          style={{
            ...titleStyle,
            fontWeight: unread
              ? "var(--weight-semibold)"
              : "var(--weight-regular)",
          }}
        >
          {title}
        </span>
        {snippet ? <span style={snippetStyle}>{snippet}</span> : null}
      </span>
      {unread ? <span aria-hidden="true" style={dotStyle} /> : null}
      {meta ? <span style={metaStyle}>{meta}</span> : null}
    </div>
  );
}
