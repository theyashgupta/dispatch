import {
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { secondaryStyle } from "./Button.js";
import { focusRing } from "./focus-ring.js";

interface LinkButtonProps extends Pick<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "aria-label"
> {
  href: string;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export function LinkButton({
  href,
  children,
  onClick,
  "aria-label": ariaLabel,
}: LinkButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{
        ...secondaryStyle,
        fontFamily: "var(--font-ui)",
        textDecoration: "none",
        whiteSpace: "nowrap",
        background: hovered ? "var(--surface-card-hover)" : "transparent",
        ...focusRing(focused),
      }}
    >
      {children}
    </a>
  );
}
