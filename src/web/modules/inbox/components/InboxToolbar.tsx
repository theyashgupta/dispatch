import type { FilterOption } from "../../../../shared/types.js";
import { MultiSelect } from "@/components/MultiSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  INBOX_RANGES,
  isInboxRange,
  type InboxGroupBy,
  type InboxRange,
} from "@/modules/inbox/domain/inbox-rows";

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
  state: "Group by state",
};

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
  const filtersActive =
    search.trim() !== "" ||
    selectedSourceIds.length > 0 ||
    range !== "all" ||
    unreadOnly;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-(--surface-column) px-4 py-2">
      <Input
        type="text"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search inbox…"
        aria-label="Search inbox"
        className="h-8 w-55 max-w-full flex-none text-base md:text-base"
      />
      <div className="w-40 shrink-0">
        <MultiSelect
          label="Source filter"
          placeholder="All sources"
          options={sourceOptions}
          selected={selectedSourceIds}
          emptyText="No sources"
          onChange={onSourcesChange}
        />
      </div>
      <Select
        value={range}
        onValueChange={(value) => {
          if (isInboxRange(value)) onRangeChange(value);
        }}
      >
        <SelectTrigger size="sm" aria-label="Time range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {INBOX_RANGES.map((key) => (
            <SelectItem key={key} value={key}>
              {RANGE_LABEL[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToggleGroup
        type="multiple"
        role={undefined}
        rovingFocus={false}
        variant="outline"
        size="sm"
        value={unreadOnly ? ["unread"] : []}
        onValueChange={(values) =>
          onUnreadOnlyChange(values.includes("unread"))
        }
      >
        <ToggleGroupItem value="unread">Unread only</ToggleGroupItem>
      </ToggleGroup>
      <Select
        value={groupBy}
        onValueChange={(value) => onGroupByChange(value as InboxGroupBy)}
      >
        <SelectTrigger size="sm" aria-label="Group by">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {(Object.keys(GROUP_LABEL) as InboxGroupBy[]).map((key) => (
            <SelectItem key={key} value={key}>
              {GROUP_LABEL[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="secondary"
        size="sm"
        disabled={unreadCount === 0}
        onClick={onMarkAllRead}
      >
        Mark all read
      </Button>
      <div className="flex-auto" />
      <span className="text-sm leading-(--line-body) whitespace-nowrap text-muted-foreground">
        {filtersActive
          ? `${visibleCount} of ${totalCount} rows`
          : `${totalCount} rows`}
      </span>
    </div>
  );
}
