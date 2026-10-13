import type { ProgressRow } from "@/modules/dashboard/domain/progress-rows";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import { DashboardSection } from "./DashboardSection";
import { ProgressRowView } from "./ProgressRowView";

interface ProgressSectionProps {
  state: SectionState;
  rows: ProgressRow[];
  countText: string | null;
  onRetry: () => void;
}

export function ProgressSection({
  state,
  rows,
  countText,
  onRetry,
}: ProgressSectionProps) {
  return (
    <DashboardSection
      title="Progress per group"
      count={countText ?? rows.length}
      state={state}
      onRetry={onRetry}
    >
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          No loops on this board yet. Start a group from the board to see its
          progress here.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-(--space-md) p-0">
          {rows.map((row) => (
            <ProgressRowView key={row.cardId} row={row} />
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}
