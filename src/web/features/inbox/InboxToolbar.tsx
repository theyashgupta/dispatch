import { useState } from "react";
import type { FilterOption } from "../../../shared/types.js";
import { MultiSelect } from "../modals/index.js";

interface InboxToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  projectOptions: FilterOption[];
  selectedProjectIds: string[];
  onProjectsChange: (ids: string[]) => void;
  visibleCount: number;
  totalCount: number;
}

export function InboxToolbar({
  search,
  onSearchChange,
  projectOptions,
  selectedProjectIds,
  onProjectsChange,
  visibleCount,
  totalCount,
}: InboxToolbarProps) {
  const [searchFocus, setSearchFocus] = useState(false);
  const filtersActive = search.trim() !== "" || selectedProjectIds.length > 0;

  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
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
        onFocus={() => setSearchFocus(true)}
        onBlur={() => setSearchFocus(false)}
        placeholder="Search inbox…"
        aria-label="Search inbox"
        style={{
          width: "240px",
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
          boxShadow: searchFocus ? "0 0 0 2px var(--accent)" : "none",
          flex: "0 0 auto",
        }}
      />
      <div style={{ width: "220px", flex: "0 0 auto" }}>
        <MultiSelect
          label="Project filter"
          placeholder="All projects"
          options={projectOptions}
          selected={selectedProjectIds}
          loading={false}
          loadError={false}
          emptyText="No projects"
          onChange={onProjectsChange}
        />
      </div>
      <div style={{ flex: "1 1 auto" }} />
      <span
        style={{
          fontSize: "var(--font-label)",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {filtersActive
          ? `${visibleCount} of ${totalCount} tickets`
          : `${totalCount} tickets`}
      </span>
    </div>
  );
}
