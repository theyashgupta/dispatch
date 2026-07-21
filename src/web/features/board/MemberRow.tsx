import { ExternalLink } from "lucide-react";
import type { Card as CardModel, PrInfo } from "../../../shared/types.js";
import { PrBadge, SourceBadge } from "../badges/index.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";

interface MemberRowProps {
  member: CardModel;
  dense?: boolean;
  groupPr?: PrInfo[];
}

export function MemberRow({ member, dense = true, groupPr }: MemberRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        padding: "var(--space-xs) 0",
      }}
    >
      <Field mono style={{ flex: "0 0 auto" }}>
        {member.identifier}
      </Field>
      <span
        style={{
          fontSize: dense ? "var(--font-label)" : "var(--font-body)",
          fontWeight: "var(--weight-regular)",
          lineHeight: dense ? "var(--line-label)" : "var(--line-body)",
          color: "var(--text)",
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {member.title}
      </span>
      {groupPr?.map((pr) => (
        <PrBadge key={pr.number} pr={pr} />
      ))}
      <SourceBadge source={member.source ?? "linear"} />
      {member.source === "linear" && member.url != null && (
        <IconButton
          aria-label={`Open ${member.identifier} in Linear`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            window.open(member.url, "_blank", "noopener,noreferrer");
          }}
        >
          <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
