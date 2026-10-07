import { Badge } from "@/components/ui/badge";
import type { WorkspaceSubgroup } from "@/modules/workspace/domain/orca-selectors";
import { OrcaNavRow } from "./OrcaNavRow";

interface OrcaSubgroupSectionProps {
  subgroup: WorkspaceSubgroup;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
}

export function OrcaSubgroupSection({
  subgroup,
  selectedCardId,
  onSelectCard,
}: OrcaSubgroupSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-1 text-muted-foreground">
        <span className="text-sm text-muted-foreground">{subgroup.label}</span>
        <Badge
          stateColor={subgroup.accent}
          className={
            subgroup.accent
              ? "h-auto rounded-md border-0 bg-[color-mix(in_srgb,var(--badge-state)_16%,var(--surface-column))] text-sm leading-(--line-body) font-normal text-[color-mix(in_srgb,var(--badge-state)_35%,var(--text))]"
              : "h-auto rounded-md border-0 bg-card text-sm leading-(--line-body) font-normal text-muted-foreground"
          }
        >
          {subgroup.cards.length}
        </Badge>
      </div>
      {subgroup.cards.map((card) => (
        <OrcaNavRow
          key={card.id}
          card={card}
          selected={card.id === selectedCardId}
          onSelect={onSelectCard}
        />
      ))}
    </div>
  );
}
