import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { SourceBadge } from "@/components/badges";
import { DetailPlaceholder } from "@/components/DetailPaneBody";
import { ListGroup, RowTime } from "@/components/ListGroup";
import { ListItemRow } from "@/components/ListItemRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  slackAuthor,
  slackPills,
  type SlackGroup,
  type SlackRow,
} from "@/modules/slack/domain/slack-rows";

interface SlackListProps {
  groups: SlackGroup[];
  selectedId: string | null;
  narrow: boolean;
  enabled: boolean;
  empty: boolean;
  onSelect: (row: SlackRow) => void;
  onOpenSettings: () => void;
}

export function SlackList({
  groups,
  selectedId,
  narrow,
  enabled,
  empty,
  onSelect,
  onOpenSettings,
}: SlackListProps) {
  return (
    <div className="scroll-stable-y min-h-0 flex-1 overflow-y-auto">
      {!enabled ? (
        <Empty className="py-12" data-testid="slack-off">
          <EmptyHeader>
            <EmptyTitle className="text-sm font-semibold text-muted-foreground">
              Slack is off. Turn it on in Settings.
            </EmptyTitle>
          </EmptyHeader>
          <Button type="button" onClick={onOpenSettings}>
            Open Settings
          </Button>
        </Empty>
      ) : empty ? (
        <DetailPlaceholder>No Slack mentions or DMs yet.</DetailPlaceholder>
      ) : (
        groups.map((group) => (
          <ListGroup
            key={group.key}
            title={group.label}
            count={group.rows.length}
            testId="slack-group"
          >
            {group.rows.map((row) => (
              <ListItemRow
                key={row.id}
                id={`slack-row-${row.id}`}
                selected={row.id === selectedId}
                unread={row.unread}
                onSelect={() => onSelect(row)}
                leading={<SourceBadge source="slack" />}
                title={slackAuthor(row.item)}
                snippet={row.snippet}
                meta={
                  <>
                    {slackPills(row.item)
                      .filter((pill) => !narrow || pill.tone === "accent")
                      .map((pill) => (
                        <Badge
                          key={pill.label}
                          tone={pill.tone}
                          title={pill.label}
                          className={
                            pill.tone === "neutral" ? "max-w-30" : undefined
                          }
                        >
                          <span className="truncate">{pill.label}</span>
                        </Badge>
                      ))}
                    <RowTime>{formatAge(row.time, nowMs())}</RowTime>
                  </>
                }
              />
            ))}
          </ListGroup>
        ))
      )}
    </div>
  );
}
