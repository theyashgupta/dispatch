import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { Chip } from "../../primitives/Chip.js";
import { ListGroup, RowTime } from "../../primitives/ListGroup.js";
import { ListRow } from "../../primitives/ListRow.js";
import { SourceBadge } from "../../components/badges/index.js";
import { CATEGORY_LABEL, type PrGroup, type PrRow } from "../../lib/pr-rows.js";

interface PrListProps {
  groups: PrGroup[];
  selectedKey: string | null;
  onSelect: (row: PrRow) => void;
}

export function PrList({ groups, selectedKey, onSelect }: PrListProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  return (
    <>
      {groups.map((group) => (
        <ListGroup
          key={group.key}
          title={group.label}
          count={group.rows.length}
          testId="pr-group"
        >
          {group.rows.map((row) => (
            <ListRow
              key={row.key}
              id={`pr-row-${row.key}`}
              selected={row.key === selectedKey}
              unread={row.unread}
              onSelect={() => onSelect(row)}
              snippet={row.author ? `${row.repo} by ${row.author}` : row.repo}
              leading={<SourceBadge source="github" />}
              title={`#${row.number} ${row.title}`}
              meta={
                <>
                  {!narrow && row.category !== "yours" && (
                    <Chip>{CATEGORY_LABEL[row.category]}</Chip>
                  )}
                  {row.yours && <Chip tone="accent">Yours</Chip>}
                  {row.draft && <Chip>Draft</Chip>}
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
