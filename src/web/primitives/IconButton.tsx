import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";

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
};

export function IconButton({
  style,
  disabled,
  type = "button",
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...rest
}: IconButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  if (disabled && (hovered || focused)) {
    setHovered(false);
    setFocused(false);
  }
  const composed: CSSProperties = {
    ...iconButtonStyle,
    background: hovered ? "var(--surface-card-hover)" : "transparent",
    boxShadow: focused ? "0 0 0 2px var(--accent)" : "none",
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
