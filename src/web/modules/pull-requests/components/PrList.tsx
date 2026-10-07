import {
  CATEGORY_LABEL,
  type PrGroup,
  type PrGroupBy,
  type PrRow,
} from "../../../../shared/pr-rows.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { SourceBadge } from "@/components/badges";
import { ConnectSourceEmpty } from "@/components/ConnectSourceEmpty";
import { DetailPlaceholder } from "@/components/DetailPaneBody";
import { GroupByToolbar } from "@/components/GroupByToolbar";
import { ListGroup, RowTime } from "@/components/ListGroup";
import { ListItemRow } from "@/components/ListItemRow";
import { Badge } from "@/components/ui/badge";

interface PrListProps {
  groups: PrGroup[];
  selectedKey: string | null;
  narrow: boolean;
  groupBy: PrGroupBy;
  connected: boolean;
  partial: boolean;
  empty: boolean;
  onGroupByChange: (value: PrGroupBy) => void;
  onSelect: (row: PrRow) => void;
  onOpenSettings: () => void;
}

const GROUP_LABEL: Record<PrGroupBy, string> = {
  repo: "Repo",
  author: "Author",
  type: "Type",
};

export function PrList({
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
}: PrListProps) {
  return (
    <>
      <GroupByToolbar
        value={groupBy}
        labels={GROUP_LABEL}
        onChange={onGroupByChange}
      />
      {partial && (
        <div className="px-4 py-2 text-sm font-semibold text-muted-foreground">
          Some pull requests may be missing: GitHub returned more than 100
          results in a search, or an organization needs SAML single sign-on.
        </div>
      )}
      <div className="scroll-stable-y min-h-0 flex-1 overflow-y-auto">
        {!connected ? (
          <ConnectSourceEmpty
            testId="pr-connect"
            description="GitHub is not connected. Connect it in Settings and the pull requests that wait on you land here."
            onOpenSettings={onOpenSettings}
          />
        ) : empty ? (
          <DetailPlaceholder>No pull requests wait on you.</DetailPlaceholder>
        ) : (
          groups.map((group) => (
            <ListGroup
              key={group.key}
              title={group.label}
              count={group.rows.length}
              testId="pr-group"
            >
              {group.rows.map((row) => (
                <ListItemRow
                  key={row.key}
                  id={`pr-row-${row.key}`}
                  selected={row.key === selectedKey}
                  unread={row.unread}
                  onSelect={() => onSelect(row)}
                  snippet={
                    row.author ? `${row.repo} by ${row.author}` : row.repo
                  }
                  leading={<SourceBadge source="github" />}
                  title={`#${row.number} ${row.title}`}
                  meta={
                    <>
                      {!narrow && row.category !== "yours" && (
                        <Badge tone="neutral">
                          {CATEGORY_LABEL[row.category]}
                        </Badge>
                      )}
                      {row.yours && <Badge tone="accent">Yours</Badge>}
                      {row.draft && <Badge tone="neutral">Draft</Badge>}
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
