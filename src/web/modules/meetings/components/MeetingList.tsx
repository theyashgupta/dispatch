import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { SourceBadge } from "@/components/badges";
import { ListGroup, RowTime } from "@/components/ListGroup";
import { ListItemRow } from "@/components/ListItemRow";
import { Badge } from "@/components/ui/badge";
import {
  snippetBodyLine,
  type MeetingGroup,
} from "@/modules/meetings/domain/meetings";

interface MeetingListProps {
  groups: MeetingGroup[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export function MeetingList({
  groups,
  selectedId,
  onSelect,
}: MeetingListProps) {
  return (
    <div className="scroll-stable-y min-h-0 flex-1 overflow-y-auto py-2">
      {groups.map((group) => (
        <ListGroup
          key={group.id}
          title={group.meeting}
          count={group.items.length}
          meta={
            <>
              <span>{group.meetingDate}</span>
              <Badge tone="neutral">
                {group.feed === "granola" ? "Granola" : "Pasted"}
              </Badge>
            </>
          }
        >
          {group.items.map((item) => (
            <ListItemRow
              key={item.id}
              id={`meeting-row-${item.id}`}
              selected={item.id === selectedId}
              unread={item.state === "unread"}
              onSelect={() => onSelect(item.id)}
              leading={<SourceBadge source={item.source} />}
              title={item.title}
              snippet={snippetBodyLine(item.snippet)}
              meta={<RowTime>{formatAge(item.createdAt, nowMs())}</RowTime>}
            />
          ))}
        </ListGroup>
      ))}
    </div>
  );
}
