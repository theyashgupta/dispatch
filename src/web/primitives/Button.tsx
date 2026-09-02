import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type Ref,
} from "react";
import { focusRing } from "./focus-ring.js";
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
  transition: "var(--hover-transition)",
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
  transition: "var(--hover-transition)",
};

const dangerStyle: CSSProperties = {
  height: "32px",
  padding: "0 var(--space-lg)",
  background: "var(--destructive-button-fill)",
  border: "none",
  borderRadius: "var(--radius)",
  color: "#ffffff",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  cursor: "pointer",
  outline: "none",
  transition: "var(--hover-transition)",
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
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  children,
  ...rest
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const isDisabled = disabled || loading;
  if (isDisabled && (hovered || focused || pressed)) {
    setHovered(false);
    setFocused(false);
    setPressed(false);
  }
  const base =
    variant === "primary"
      ? primaryStyle
      : variant === "danger"
        ? dangerStyle
        : secondaryStyle;
  const isDanger = variant === "danger";
  const composed: CSSProperties = {
    ...base,
    background:
      variant === "secondary"
        ? pressed
          ? "var(--pressed-card-hover)"
          : hovered
            ? "var(--surface-card-hover)"
            : "transparent"
        : pressed
          ? isDanger
            ? "var(--pressed-button-danger)"
            : "var(--pressed-button-primary)"
          : hovered
            ? isDanger
              ? "var(--hover-button-danger)"
              : "var(--hover-button-primary)"
            : base.background,
    ...focusRing(focused),
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
      onPointerDown={(event) => {
        setPressed(true);
        onPointerDown?.(event);
      }}
      onPointerUp={(event) => {
        setPressed(false);
        onPointerUp?.(event);
      }}
      onPointerCancel={(event) => {
        setPressed(false);
        onPointerCancel?.(event);
      }}
      onPointerLeave={(event) => {
        setPressed(false);
        onPointerLeave?.(event);
      }}
      style={composed}
      {...(loading ? { "aria-busy": true } : null)}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
