import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type Ref,
} from "react";
import { Spinner } from "./Spinner.js";

type ButtonVariant = "secondary" | "primary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
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

const dangerStyle: CSSProperties = {
  height: "32px",
  padding: "0 var(--space-lg)",
  background: "var(--destructive)",
  border: "none",
  borderRadius: "var(--radius)",
  color: "#ffffff",
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
  loading,
  type = "button",
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  children,
  ...rest
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const isDisabled = disabled || loading;
  if (isDisabled && (hovered || focused)) {
    setHovered(false);
    setFocused(false);
  }
  const base =
    variant === "primary"
      ? primaryStyle
      : variant === "danger"
        ? dangerStyle
        : secondaryStyle;
  const composed: CSSProperties = {
    ...base,
    background:
      variant === "secondary"
        ? hovered
          ? "var(--surface-card-hover)"
          : "transparent"
        : base.background,
    boxShadow: focused ? "0 0 0 2px var(--accent)" : "none",
    ...(isDisabled ? { cursor: "default", opacity: 0.5 } : null),
    ...(loading
      ? {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-xs)",
        }
      : null),
    ...style,
  };
  return (
    <button
      type={type}
      disabled={isDisabled}
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
      {...(loading ? { "aria-busy": true } : null)}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
