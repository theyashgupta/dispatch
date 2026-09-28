import { useState } from "react";
import { Select } from "../../primitives/Select.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { TICKETS_GROUP_BY, type TicketsGroupBy } from "./ticket-rows.js";

interface TicketsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  groupBy: TicketsGroupBy;
  onGroupByChange: (value: TicketsGroupBy) => void;
  visibleCount: number;
  totalCount: number;
}

const GROUP_LABEL: Record<TicketsGroupBy, string> = {
  none: "No grouping",
  status: "Group by status",
  priority: "Group by priority",
  project: "Group by project",
  cycle: "Group by cycle",
  team: "Group by team",
};

export function TicketsToolbar({
  search,
  onSearchChange,
  groupBy,
  onGroupByChange,
  visibleCount,
  totalCount,
}: TicketsToolbarProps) {
  const [searchFocus, setSearchFocus] = useState(false);

  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-lg)",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-column)",
      }}
    >
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onFocus={(event) =>
          setSearchFocus(event.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setSearchFocus(false)}
        placeholder="Search tickets…"
        aria-label="Search tickets"
        style={{
          width: "220px",
          maxWidth: "100%",
          height: "32px",
          boxSizing: "border-box",
          padding: "0 var(--space-sm)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--text)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--font-body)",
          lineHeight: "var(--line-body)",
          outline: "none",
          ...focusRing(searchFocus),
          flex: "0 0 auto",
        }}
      />
      <Select
        label="Group by"
        value={groupBy}
        onChange={onGroupByChange}
        style={{ flex: "0 0 auto" }}
      >
        {TICKETS_GROUP_BY.map((key) => (
          <option key={key} value={key}>
            {GROUP_LABEL[key]}
          </option>
        ))}
      </Select>
      <div style={{ flex: "1 1 auto" }} />
      <span
        style={{
          fontSize: "var(--font-label)",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {search.trim() !== ""
          ? `${visibleCount} of ${totalCount} rows`
          : `${totalCount} rows`}
      </span>
    </div>
  );
}
