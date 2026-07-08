import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type Ref,
} from "react";

type ButtonVariant = "secondary" | "primary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  ref?: Ref<HTMLButtonElement>;
}

const secondaryStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  cursor: "pointer",
  outline: "none",
};

const primaryStyle: CSSProperties = {
  height: "32px",
  padding: "0 var(--space-lg)",
  background: "var(--accent)",
  border: "none",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  cursor: "pointer",
  outline: "none",
};

export function Button({
  variant = "secondary",
  style,
  disabled,
  type = "button",
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...rest
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  if (disabled && (hovered || focused)) {
    setHovered(false);
    setFocused(false);
  }
  const base = variant === "primary" ? primaryStyle : secondaryStyle;
  const composed: CSSProperties = {
    ...base,
    background:
      variant === "secondary"
        ? hovered
          ? "var(--surface-card-hover)"
          : "transparent"
        : base.background,
    boxShadow: focused ? "0 0 0 2px var(--accent)" : "none",
    ...(disabled ? { cursor: "default", opacity: 0.5 } : null),
    ...style,
  };
  return (
    <button
      type={type}
      disabled={disabled}
      {...rest}
      onMouseEnter={(event) => {
        setHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        setFocused(event.currentTarget.matches(":focus-visible"));
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={composed}
    />
  );
}
