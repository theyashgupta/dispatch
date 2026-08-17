import type { Column } from "../../../shared/types.js";
import { SINGLE_LINE_COPY } from "../board/index.js";
import type { GroupDimension, WorkspaceGroup } from "./orca-selectors.js";
import { OrcaNavRow } from "./OrcaNavRow.js";
import { OrcaSubgroupSection } from "./OrcaSubgroupSection.js";

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
      <div
        style={{
          height: "var(--column-header-height)",
          position: "sticky",
          top: 0,
          background: "var(--surface-column)",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-lg)",
          color: "var(--text-muted)",
        }}
      >
        <span
          style={{
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-medium)",
            lineHeight: "var(--line-label)",
            letterSpacing: "0.04em",
            color: "var(--text-muted)",
          }}
        >
          {group.label}
        </span>
        <span
          style={{
            background: group.accent
              ? `color-mix(in srgb, ${group.accent} 16%, var(--surface-column))`
              : "var(--surface-card)",
            color: group.accent ?? "var(--text-muted)",
            borderRadius: "var(--radius-sm)",
            padding: "0 var(--space-xs)",
            fontSize: "var(--font-micro)",
          }}
        >
          {group.count}
        </span>
      </div>
      {group.subgroups.length === 0 ? (
        <div
          style={{
            padding: "var(--space-xs) var(--space-sm)",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-regular)",
            color: "var(--text-muted)",
          }}
        >
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
