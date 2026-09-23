import { useState, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { focusRing } from "../../primitives/focus-ring.js";

interface NavRowProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed: boolean;
  badge?: ReactNode;
  onSelect: () => void;
  rowRef?: (el: HTMLButtonElement | null) => void;
}

const rowStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  width: "100%",
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-medium)",
  lineHeight: "var(--line-body)",
  cursor: "pointer",
  outline: "none",
  textAlign: "left",
  whiteSpace: "nowrap",
  transition: "var(--hover-transition)",
};

const labelStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export function NavRow({
  icon: Icon,
  label,
  active,
  collapsed,
  badge,
  onSelect,
  rowRef,
}: NavRowProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <button
      ref={rowRef}
      type="button"
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{
        ...rowStyle,
        justifyContent: collapsed ? "center" : "flex-start",
        padding: collapsed ? 0 : rowStyle.padding,
        color: active ? "var(--accent)" : "var(--text-muted)",
        background:
          hovered && !active ? "var(--surface-card-hover)" : "transparent",
        ...focusRing(focused),
      }}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      {collapsed ? null : <span style={labelStyle}>{label}</span>}
      {collapsed ? null : badge}
    </button>
  );
}
