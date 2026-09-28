import { useState, type CSSProperties, type ReactNode } from "react";
import { focusRing } from "./focus-ring.js";

interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  style?: CSSProperties;
  disabled?: boolean;
}

const selectStyle: CSSProperties = {
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  outline: "none",
  minWidth: 0,
};

export function Select({
  label,
  value,
  onChange,
  children,
  style,
  disabled,
}: SelectProps) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{
        ...selectStyle,
        ...style,
        ...focusRing(focused),
        ...(disabled ? { cursor: "default", opacity: 0.5 } : null),
      }}
    >
      {children}
    </select>
  );
}
