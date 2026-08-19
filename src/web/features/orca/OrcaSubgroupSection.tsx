import type { WorkspaceSubgroup } from "./orca-selectors.js";
import { OrcaNavRow } from "./OrcaNavRow.js";

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-xs) var(--space-lg)",
          color: "var(--text-muted)",
        }}
      >
        <span
          style={{
            fontSize: "var(--font-label)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          {subgroup.label}
        </span>
        <span
          style={{
            background: subgroup.accent
              ? `color-mix(in srgb, ${subgroup.accent} 16%, var(--surface-column))`
              : "var(--surface-card)",
            color: subgroup.accent ?? "var(--text-muted)",
            borderRadius: "var(--radius)",
            padding: "0 var(--space-xs)",
            fontSize: "var(--font-label)",
          }}
        >
          {subgroup.cards.length}
        </span>
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
