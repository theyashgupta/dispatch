import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { SourceBadge } from "@/components/badges";
import { ConnectSourceEmpty } from "@/components/ConnectSourceEmpty";
import { DetailPlaceholder } from "@/components/DetailPaneBody";
import { GroupByToolbar } from "@/components/GroupByToolbar";
import { ListGroup, RowTime } from "@/components/ListGroup";
import { ListItemRow } from "@/components/ListItemRow";
import { Badge } from "@/components/ui/badge";
import {
  levelTone,
  type ErrorGroup,
  type ErrorGroupBy,
  type ErrorRow,
} from "@/modules/errors/domain/error-rows";

interface ErrorListProps {
  groups: ErrorGroup[];
  selectedKey: string | null;
  narrow: boolean;
  groupBy: ErrorGroupBy;
  connected: boolean;
  partial: boolean;
  empty: boolean;
  onGroupByChange: (value: ErrorGroupBy) => void;
  onSelect: (row: ErrorRow) => void;
  onOpenSettings: () => void;
}

const GROUP_LABEL: Record<ErrorGroupBy, string> = {
  project: "Project",
  level: "Level",
};

export function ErrorList({
  groups,
  selectedKey,
  narrow,
  groupBy,
  connected,
  partial,
  empty,
  onGroupByChange,
  onSelect,
  onOpenSettings,
}: ErrorListProps) {
  return (
    <>
      <GroupByToolbar
        value={groupBy}
        labels={GROUP_LABEL}
        onChange={onGroupByChange}
      />
      {partial && (
        <div className="px-4 py-2 text-sm font-semibold text-muted-foreground">
          Some errors may be missing: Sentry returned 100 or more issues in a
          query, more than 10 organizations, or an organization refused access.
        </div>
      )}
      <div className="scroll-stable-y min-h-0 flex-1 overflow-y-auto">
        {!connected ? (
          <ConnectSourceEmpty
            testId="errors-connect"
            description="Sentry is not connected. Connect it in Settings and the errors that need you land here."
            onOpenSettings={onOpenSettings}
          />
        ) : empty ? (
          <DetailPlaceholder>No errors need you.</DetailPlaceholder>
        ) : (
          groups.map((group) => (
            <ListGroup
              key={group.key}
              title={group.label}
              count={group.rows.length}
              testId="error-group"
            >
              {group.rows.map((row) => (
                <ListItemRow
                  key={row.key}
                  id={`error-row-${row.key}`}
                  selected={row.key === selectedKey}
                  unread={row.unread}
                  onSelect={() => onSelect(row)}
                  snippet={
                    narrow
                      ? row.culprit
                      : `${row.count} ${row.count === 1 ? "event" : "events"} · ${row.culprit}`
                  }
                  leading={<SourceBadge source="sentry" />}
                  title={
                    row.shortId ? `${row.shortId} ${row.title}` : row.title
                  }
                  meta={
                    <>
                      <Badge tone={levelTone(row.level)}>
                        {row.level || "unknown"}
                      </Badge>
                      {row.assigned && <Badge tone="accent">Assigned</Badge>}
                      <RowTime>{formatAge(row.time, nowMs())}</RowTime>
                    </>
                  }
                />
              ))}
            </ListGroup>
          ))
        )}
      </div>
    </>
  );
}
