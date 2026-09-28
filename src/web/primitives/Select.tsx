import { useState, type CSSProperties, type ReactNode } from "react";
import { focusRing } from "./focus-ring.js";

const selectStyle: CSSProperties = {
  flex: "0 0 auto",
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
};

const shrinkableSelectStyle: CSSProperties = {
  ...selectStyle,
  flex: undefined,
  minWidth: 0,
};

type SelectProps<T extends string> = {
  label: string;
  value: T;
  onChange: (value: T) => void;
  style?: CSSProperties;
  disabled?: boolean;
} & (
  | { labels: Record<T, string>; children?: never }
  | { labels?: never; children: ReactNode }
);

export function Select<T extends string>({
  label,
  value,
  onChange,
  style,
  disabled,
  labels,
  children,
}: SelectProps<T>) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{
        ...(labels ? selectStyle : shrinkableSelectStyle),
        ...style,
        ...focusRing(focused),
        ...(disabled ? { cursor: "default", opacity: 0.5 } : null),
      }}
    >
      {labels
        ? (Object.keys(labels) as T[]).map((key) => (
            <option key={key} value={key}>
              {labels[key]}
            </option>
          ))
        : children}
    </select>
  );
}
