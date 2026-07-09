import type { CSSProperties } from "react";

interface GlyphProps {
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Glyph({ size = 16, title, className, style }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 86"
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      style={style}
    >
      {title ? <title>{title}</title> : null}
      <path d="M12 18 H40 C52 18 44 43 56 43" />
      <path d="M12 68 H40 C52 68 44 43 56 43" />
      <path d="M12 43 H96" />
      <path d="M82 30 L104 43 L82 56" />
    </svg>
  );
}
