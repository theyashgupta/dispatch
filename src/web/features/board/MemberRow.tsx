import { ExternalLink } from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import { SourceBadge } from "../badges/index.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";

interface MemberRowProps {
  member: CardModel;
}

export function MemberRow({ member }: MemberRowProps) {
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
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-regular)",
          lineHeight: "var(--line-label)",
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
      <SourceBadge source={member.source ?? "linear"} />
      {member.source === "linear" && member.url != null && (
        <IconButton
          aria-label={`Open ${member.identifier} in Linear`}
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
