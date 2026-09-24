import { useState, type CSSProperties } from "react";
import type { FilterOption } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { MultiSelect } from "../modals/index.js";
import type { InboxGroupBy, InboxRange } from "./inbox-rows.js";

interface InboxToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  sourceOptions: FilterOption[];
  selectedSourceIds: string[];
  onSourcesChange: (ids: string[]) => void;
  range: InboxRange;
  onRangeChange: (range: InboxRange) => void;
  unreadOnly: boolean;
  onUnreadOnlyChange: (value: boolean) => void;
  groupBy: InboxGroupBy;
  onGroupByChange: (value: InboxGroupBy) => void;
  unreadCount: number;
  onMarkAllRead: () => void;
  visibleCount: number;
  totalCount: number;
}

const RANGE_LABEL: Record<InboxRange, string> = {
  all: "All time",
  today: "Today",
  "3d": "Last 3 days",
  week: "Last week",
};

const GROUP_LABEL: Record<InboxGroupBy, string> = {
  none: "No grouping",
  source: "Group by source",
  type: "Group by type",
};

const selectStyle: CSSProperties = {
  flex: "0 0 auto",
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  outline: "none",
};

interface SelectProps<T extends string> {
  label: string;
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
}

function Select<T extends string>({
  label,
  value,
  labels,
  onChange,
}: SelectProps<T>) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{ ...selectStyle, ...focusRing(focused) }}
    >
      {(Object.keys(labels) as T[]).map((key) => (
        <option key={key} value={key}>
          {labels[key]}
        </option>
      ))}
    </select>
  );
}

export function InboxToolbar({
  search,
  onSearchChange,
  sourceOptions,
  selectedSourceIds,
  onSourcesChange,
  range,
  onRangeChange,
  unreadOnly,
  onUnreadOnlyChange,
  groupBy,
  onGroupByChange,
  unreadCount,
  onMarkAllRead,
  visibleCount,
  totalCount,
}: InboxToolbarProps) {
  const [searchFocus, setSearchFocus] = useState(false);
  const filtersActive =
    search.trim() !== "" ||
    selectedSourceIds.length > 0 ||
    range !== "all" ||
    unreadOnly;

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
        placeholder="Search inbox…"
        aria-label="Search inbox"
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
      <div style={{ width: "160px", flex: "0 0 auto" }}>
        <MultiSelect
          label="Source filter"
          placeholder="All sources"
          options={sourceOptions}
          selected={selectedSourceIds}
          loading={false}
          loadError={false}
          emptyText="No sources"
          onChange={onSourcesChange}
        />
      </div>
      <Select
        label="Time range"
        value={range}
        labels={RANGE_LABEL}
        onChange={onRangeChange}
      />
      <Button
        variant="secondary"
        aria-pressed={unreadOnly}
        onClick={() => onUnreadOnlyChange(!unreadOnly)}
        style={
          unreadOnly
            ? {
                background:
                  "color-mix(in srgb, var(--accent) 16%, var(--surface-column))",
                color: "var(--accent)",
              }
            : undefined
        }
      >
        Unread only
      </Button>
      <Select
        label="Group by"
        value={groupBy}
        labels={GROUP_LABEL}
        onChange={onGroupByChange}
      />
      <Button
        variant="secondary"
        disabled={unreadCount === 0}
        onClick={onMarkAllRead}
      >
        Mark all read
      </Button>
      <div style={{ flex: "1 1 auto" }} />
      <span
        style={{
          fontSize: "var(--font-label)",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {filtersActive
          ? `${visibleCount} of ${totalCount} rows`
          : `${totalCount} rows`}
      </span>
    </div>
  );
}
