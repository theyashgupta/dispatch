import type { ReactNode } from "react";
import { formatCount } from "../../../../shared/format-count.js";
import { Badge } from "@/components/ui/badge";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import { SectionError } from "./SectionError";
import { SectionLoading } from "./SectionLoading";

interface DashboardSectionProps {
  title: string;
  count: string | number | null;
  state: SectionState;
  onRetry: () => void;
  action?: ReactNode;
  children: ReactNode;
}

export function DashboardSection({
  title,
  count,
  state,
  onRetry,
  action,
  children,
}: DashboardSectionProps) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-base font-semibold text-foreground">{title}</h2>
        {count !== null && state.kind === "ready" && (
          <Badge tone="neutral" className="tabular-nums">
            {typeof count === "number" ? formatCount(count) : count}
          </Badge>
        )}
        {action !== undefined && <div className="ms-auto">{action}</div>}
      </div>
      {state.kind === "loading" && <SectionLoading />}
      {state.kind === "error" && (
        <SectionError title={title} message={state.message} onRetry={onRetry} />
      )}
      {state.kind === "ready" && children}
    </section>
  );
}
