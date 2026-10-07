import type { ReactNode } from "react";

interface ActivityEmptyProps {
  children: ReactNode;
}

export function ActivityEmpty({ children }: ActivityEmptyProps) {
  return (
    <div className="flex justify-center p-(--space-xl) text-base leading-(--line-body) text-muted-foreground italic">
      {children}
    </div>
  );
}
