import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

interface BranchBandProps {
  id: string;
  label: string;
  count: number;
  children: ReactNode;
}

export function BranchBand({ id, label, count, children }: BranchBandProps) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-(--space-sm)">
      <div className="flex items-center gap-(--space-sm)">
        <h3
          id={id}
          className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {label}
        </h3>
        <Badge tone="neutral">{count}</Badge>
      </div>
      {count > 0 && (
        <ul className="m-0 flex list-none flex-col gap-(--space-sm) p-0">
          {children}
        </ul>
      )}
    </section>
  );
}
