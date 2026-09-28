import type { CSSProperties } from "react";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import {
  slackAuthor,
  slackPills,
  type SlackGroup,
  type SlackRow,
} from "../../lib/slack-rows.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { ListRow } from "../../primitives/ListRow.js";
import { SourceBadge } from "../badges/index.js";

interface SlackListProps {
  groups: SlackGroup[];
  selectedId: string | null;
  onSelect: (row: SlackRow) => void;
}

const fromChipStyle: CSSProperties = { maxWidth: "120px" };

const timeStyle: CSSProperties = {
  flex: "0 0 auto",
  minWidth: "48px",
  whiteSpace: "nowrap",
  textAlign: "right",
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

export function SlackList({ groups, selectedId, onSelect }: SlackListProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  return (
    <>
      {groups.map((group) => (
        <div
          key={group.key}
          style={{ padding: "0 var(--space-lg)" }}
          data-testid="slack-group"
        >
          <Collapsible
            title={group.label}
            badge={<Chip>{group.rows.length}</Chip>}
            defaultOpen
          >
            <div role="list" style={{ margin: "0 calc(-1 * var(--space-lg))" }}>
              {group.rows.map((row) => (
                <ListRow
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
                          <Chip
                            key={pill.label}
                            tone={pill.tone}
                            title={pill.label}
                            style={
                              pill.tone === "neutral"
                                ? fromChipStyle
                                : undefined
                            }
                          >
                            {pill.label}
                          </Chip>
                        ))}
                      <span style={timeStyle}>
                        {formatAge(row.time, nowMs())}
                      </span>
                    </>
                  }
                />
              ))}
            </div>
          </Collapsible>
        </div>
      ))}
    </>
  );
}
