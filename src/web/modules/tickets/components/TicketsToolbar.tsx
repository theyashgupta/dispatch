import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TICKETS_GROUP_BY,
  type TicketsGroupBy,
} from "@/modules/tickets/domain/ticket-rows";

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
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-sidebar px-4 py-2">
      <Input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search tickets…"
        aria-label="Search tickets"
        className="h-8 w-55 max-w-full flex-none"
      />
      <Select
        value={groupBy}
        onValueChange={(value) => onGroupByChange(value as TicketsGroupBy)}
      >
        <SelectTrigger size="sm" aria-label="Group by" className="flex-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TICKETS_GROUP_BY.map((key) => (
            <SelectItem key={key} value={key}>
              {GROUP_LABEL[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex-1" />
      <span className="text-sm whitespace-nowrap text-muted-foreground">
        {search.trim() !== ""
          ? `${visibleCount} of ${totalCount} rows`
          : `${totalCount} rows`}
      </span>
    </div>
  );
}
