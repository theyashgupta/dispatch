import type { CSSProperties } from "react";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { ListRow } from "../../primitives/ListRow.js";
import { SourceBadge } from "../badges/index.js";
import { CATEGORY_LABEL, type PrGroup, type PrRow } from "../../lib/pr-rows.js";

interface PrListProps {
  groups: PrGroup[];
  selectedKey: string | null;
  onSelect: (row: PrRow) => void;
}

const timeStyle: CSSProperties = {
  flex: "0 0 48px",
  textAlign: "right",
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

export function PrList({ groups, selectedKey, onSelect }: PrListProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  return (
    <>
      {groups.map((group) => (
        <div
          key={group.key}
          style={{ padding: "0 var(--space-lg)" }}
          data-testid="pr-group"
        >
          <Collapsible
            title={group.label}
            badge={<Chip>{group.rows.length}</Chip>}
            defaultOpen
          >
            <div role="list" style={{ margin: "0 calc(-1 * var(--space-lg))" }}>
              {group.rows.map((row) => (
                <ListRow
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
                        <Chip>{CATEGORY_LABEL[row.category]}</Chip>
                      )}
                      {row.yours && <Chip tone="accent">Yours</Chip>}
                      {row.draft && <Chip>Draft</Chip>}
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
