import type { ReactNode } from "react";
import { formatCount } from "../../../../shared/format-count.js";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import { SectionError } from "./SectionError";
import { SectionLoading } from "./SectionLoading";

interface DashboardSectionProps {
  title: string;
  label?: string;
  count: string | number | null;
  state: SectionState;
  onRetry: () => void;
  action?: ReactNode;
  id?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}

export function DashboardSection({
  title,
  label,
  count,
  state,
  onRetry,
  action,
  id,
  tone = "default",
  children,
}: DashboardSectionProps) {
  return (
    <section
      id={id}
      tabIndex={id === undefined ? undefined : -1}
      aria-label={label ?? title}
      className={cn(
        "flex min-w-0 flex-col gap-(--space-md) rounded-(--radius-lg) bg-(--surface-column) p-(--space-lg) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        tone === "danger" &&
          "bg-[linear-gradient(var(--danger-soft),var(--danger-soft))]",
      )}
    >
      <div className="flex items-center gap-2">
        <h2
          className={cn(
            "m-0 text-xs font-semibold tracking-wider uppercase",
            tone === "danger" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {title}
        </h2>
        {count !== null && state.kind === "ready" && (
          <Badge
            tone="neutral"
            className={cn(
              "tabular-nums",
              tone === "danger" && "text-foreground",
            )}
          >
            {typeof count === "number" ? formatCount(count) : count}
          </Badge>
        )}
        {action !== undefined && <div className="ms-auto">{action}</div>}
      </div>
      {state.kind === "loading" && <SectionLoading />}
      {state.kind === "error" && (
        <SectionError
          title={label ?? title}
          message={state.message}
          onRetry={onRetry}
        />
      )}
      {state.kind === "ready" && children}
    </section>
  );
}
