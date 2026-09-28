import { useState, type CSSProperties } from "react";
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

interface SelectProps<T extends string> {
  label: string;
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
}

export function Select<T extends string>({
  label,
  value,
  labels,
  onChange,
}: SelectProps<T>) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{ ...selectStyle, ...focusRing(focused) }}
    >
      {(Object.keys(labels) as T[]).map((key) => (
        <option key={key} value={key}>
          {labels[key]}
        </option>
      ))}
    </select>
  );
}
