import type { CSSProperties } from "react";
import { formatAge, nowMs } from "../../../shared/format-age.js";
import { snippetBodyLine, type MeetingGroup } from "../../lib/meetings.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { ListRow } from "../../primitives/ListRow.js";
import { SourceBadge } from "../../components/badges/index.js";

interface MeetingListProps {
  groups: MeetingGroup[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

const groupMetaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "0 0 var(--space-xs)",
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

export function MeetingList({
  groups,
  selectedId,
  onSelect,
}: MeetingListProps) {
  return (
    <div>
      {groups.map((group) => (
        <Collapsible
          key={group.id}
          title={group.meeting}
          badge={<Chip>{group.items.length}</Chip>}
          defaultOpen
        >
          <div style={groupMetaStyle}>
            <span>{group.meetingDate}</span>
            <Chip>{group.feed === "granola" ? "Granola" : "Pasted"}</Chip>
          </div>
          <div role="list">
            {group.items.map((item) => (
              <ListRow
                key={item.id}
                leading={<SourceBadge source={item.source} />}
                title={item.title}
                snippet={snippetBodyLine(item.snippet)}
                meta={<span>{formatAge(item.createdAt, nowMs())}</span>}
                selected={item.id === selectedId}
                unread={item.state === "unread"}
                onSelect={() => onSelect(item.id)}
              />
            ))}
          </div>
        </Collapsible>
      ))}
    </div>
  );
}
