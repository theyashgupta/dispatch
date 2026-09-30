import type { ReactNode } from "react";

export interface MarkProps {
  size?: number;
}

interface MarkSvgProps {
  size: number;
  children: ReactNode;
}

export function MarkSvg({ size, children }: MarkSvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
