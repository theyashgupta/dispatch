import type { Column } from "../../../../shared/types.js";
import { SINGLE_LINE_COPY } from "../../../../shared/column-empty-copy.js";
import { Badge } from "@/components/ui/badge";
import type {
  GroupDimension,
  WorkspaceGroup,
} from "@/modules/workspace/domain/orca-selectors";
import { OrcaNavRow } from "./OrcaNavRow";
import { OrcaSubgroupSection } from "./OrcaSubgroupSection";

interface OrcaGroupSectionProps {
  dimension: GroupDimension;
  group: WorkspaceGroup;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
}

const ORCA_EMPTY_COPY: Record<Column, string> = {
  ...SINGLE_LINE_COPY,
  todo: "No tickets in To Do.",
};

export function OrcaGroupSection({
  dimension,
  group,
  selectedCardId,
  onSelectCard,
}: OrcaGroupSectionProps) {
  return (
    <div>
      <div className="sticky top-0 z-1 flex h-(--column-header-height) items-center justify-between bg-(--surface-column) px-4 text-muted-foreground">
        <span className="text-sm font-medium tracking-[0.04em] text-muted-foreground">
          {group.label}
        </span>
        <Badge
          stateColor={group.accent}
          className={
            group.accent
              ? "h-auto border-0 bg-[color-mix(in_srgb,var(--badge-state)_16%,var(--surface-column))] leading-(--line-body) font-normal text-[color-mix(in_srgb,var(--badge-state)_35%,var(--text))]"
              : "h-auto border-0 bg-card leading-(--line-body) font-normal text-muted-foreground"
          }
        >
          {group.count}
        </Badge>
      </div>
      {group.subgroups.length === 0 ? (
        <div className="px-2 py-1 text-sm leading-(--line-body) font-normal text-muted-foreground">
          {dimension === "status"
            ? ORCA_EMPTY_COPY[group.key as Column]
            : "No tickets."}
        </div>
      ) : group.subgrouped ? (
        group.subgroups.map((subgroup) => (
          <OrcaSubgroupSection
            key={subgroup.key}
            subgroup={subgroup}
            selectedCardId={selectedCardId}
            onSelectCard={onSelectCard}
          />
        ))
      ) : (
        group.subgroups[0].cards.map((card) => (
          <OrcaNavRow
            key={card.id}
            card={card}
            selected={card.id === selectedCardId}
            onSelect={onSelectCard}
          />
        ))
      )}
    </div>
  );
}
