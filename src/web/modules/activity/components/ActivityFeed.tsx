import type { ReactNode } from "react";

interface ActivityFeedProps {
  children: ReactNode;
}

export function ActivityFeed({ children }: ActivityFeedProps) {
  return (
    <div
      className="scroll-stable-y flex min-h-0 flex-auto flex-col gap-(--space-sm) overflow-y-auto px-(--space-lg) py-(--space-sm)"
      aria-live="polite"
      aria-relevant="additions"
    >
      {children}
    </div>
  );
}
