import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { focusRing } from "./focus-ring.js";

interface CollapsibleProps {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  width: "100%",
  padding: "var(--space-xs) 0",
  background: "transparent",
  border: "none",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  cursor: "pointer",
  outline: "none",
  textAlign: "left",
};

const chevronStyle: CSSProperties = {
  flex: "0 0 auto",
  transition: "transform var(--motion-panel-open) var(--easing-enter)",
};

const bodyStyle: CSSProperties = {
  display: "grid",
  transition: "grid-template-rows var(--motion-panel-open) var(--easing-enter)",
};

const innerStyle: CSSProperties = {
  overflow: "hidden",
  minHeight: 0,
};

export function Collapsible({
  title,
  badge,
  defaultOpen = false,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [focused, setFocused] = useState(false);
  const bodyId = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        onFocus={(event) =>
          setFocused(event.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setFocused(false)}
        style={{ ...headerStyle, ...focusRing(focused) }}
      >
        <ChevronRight
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          style={{
            ...chevronStyle,
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        <span style={{ flex: "1 1 auto" }}>{title}</span>
        {badge}
      </button>
      <div
        id={bodyId}
        style={{ ...bodyStyle, gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div inert={!open} style={innerStyle}>
          {children}
        </div>
      </div>
    </div>
  );
}
