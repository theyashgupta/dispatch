import { Badge } from "@/components/ui/badge";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import type { LeftItem } from "@/modules/dashboard/domain/ticket-tiles";
import { DashboardSection } from "./DashboardSection";
import { TILE_PILLS } from "./tile-pills";

interface LeftStripSectionProps {
  state: SectionState;
  items: LeftItem[];
  onRetry: () => void;
}

export function LeftStripSection({
  state,
  items,
  onRetry,
}: LeftStripSectionProps) {
  return (
    <DashboardSection
      title="Left on this board"
      count={null}
      state={state}
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-(--space-md) md:flex-row md:items-center">
        <span className="text-(length:--font-page-title) leading-(--line-display) font-semibold text-foreground tabular-nums">
          {items.length}
        </span>
        {items.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Nothing open.</p>
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {items.map((item) => {
              const { tone, Glyph, label } = TILE_PILLS[item.state];
              return (
                <li key={item.cardId}>
                  <Badge tone={tone} className="h-6 max-w-full px-2 font-mono">
                    <Glyph aria-hidden="true" />
                    {item.identifier}
                    <span className="sr-only">, {label}</span>
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DashboardSection>
  );
}
