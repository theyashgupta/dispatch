import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BandKey } from "@/modules/orchestrator/domain/centre-graph";

const TINTS: Partial<Record<BandKey, string>> = {
  needs_you: "rounded-md bg-warn-soft p-(--space-sm)",
  done: "rounded-md bg-ok-soft p-(--space-sm)",
  shipped: "rounded-md bg-ok-soft p-(--space-sm)",
};

interface BranchBandProps {
  id: string;
  bandKey: BandKey;
  label: string;
  count: number;
  children: ReactNode;
}

export function BranchBand({
  id,
  bandKey,
  label,
  count,
  children,
}: BranchBandProps) {
  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-(--space-sm)", TINTS[bandKey])}
    >
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
