import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { Chip } from "../../primitives/Chip.js";
import { ListGroup, RowTime } from "../../primitives/ListGroup.js";
import { ListRow } from "../../primitives/ListRow.js";
import { SourceBadge } from "../badges/index.js";
import { levelTone, type ErrorGroup, type ErrorRow } from "./error-rows.js";

interface ErrorListProps {
  groups: ErrorGroup[];
  selectedKey: string | null;
  onSelect: (row: ErrorRow) => void;
}

export function ErrorList({ groups, selectedKey, onSelect }: ErrorListProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  return (
    <>
      {groups.map((group) => (
        <ListGroup
          key={group.key}
          title={group.label}
          count={group.rows.length}
          testId="error-group"
        >
          {group.rows.map((row) => (
            <ListRow
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
              title={row.shortId ? `${row.shortId} ${row.title}` : row.title}
              meta={
                <>
                  <Chip tone={levelTone(row.level)}>
                    {row.level || "unknown"}
                  </Chip>
                  {row.assigned && <Chip tone="accent">Assigned</Chip>}
                  <RowTime>{formatAge(row.time, nowMs())}</RowTime>
                </>
              }
            />
          ))}
        </ListGroup>
      ))}
    </>
  );
}
