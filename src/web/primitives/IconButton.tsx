import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { focusRing } from "./focus-ring.js";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
}

const iconButtonStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  padding: 0,
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius)",
  color: "var(--text-muted)",
  cursor: "pointer",
  outline: "none",
  transition: "var(--hover-transition)",
};

export function IconButton({
  style,
  disabled,
  type = "button",
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  ...rest
}: IconButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  if (disabled && (hovered || focused || pressed)) {
    setHovered(false);
    setFocused(false);
    setPressed(false);
  }
  const callerBackground = style?.background;
  const composed: CSSProperties = {
    ...iconButtonStyle,
    ...style,
    background:
      callerBackground != null
        ? pressed
          ? `color-mix(in srgb, black 12%, ${callerBackground})`
          : hovered
            ? "color-mix(in srgb, var(--accent) 22%, var(--surface-column))"
            : callerBackground
        : pressed
          ? "var(--pressed-card-hover)"
          : hovered
            ? "var(--surface-card-hover)"
            : "transparent",
    ...focusRing(focused),
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
    />
  );
}
