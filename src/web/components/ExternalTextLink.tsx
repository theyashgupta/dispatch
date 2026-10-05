import type { ReactNode } from "react";
import { isWebUrl } from "../../shared/web-url.js";
import { cn } from "@/lib/utils";

interface ExternalTextLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
}

export function ExternalTextLink({
  href,
  className,
  children,
}: ExternalTextLinkProps) {
  if (!isWebUrl(href)) return <span>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-foreground underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </a>
  );
}
