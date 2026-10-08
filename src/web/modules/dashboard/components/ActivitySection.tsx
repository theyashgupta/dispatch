import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ActivityActorFilter,
  ActivityRow,
} from "@/modules/dashboard/domain/activity-rows";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import { DashboardSection } from "./DashboardSection";

const ACTORS: { value: ActivityActorFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "orchestrator", label: "Orchestrator" },
  { value: "supervisor", label: "Supervisor" },
  { value: "you", label: "You" },
];

interface ActivitySectionProps {
  state: SectionState;
  rows: ActivityRow[];
  total: number;
  hasMore: boolean;
  actorValue: ActivityActorFilter;
  groupValue: string;
  groups: { id: string; label: string }[];
  onActorChange: (value: ActivityActorFilter) => void;
  onGroupChange: (value: string) => void;
  onShowMore: () => void;
  onRetry: () => void;
}

export function ActivitySection({
  state,
  rows,
  total,
  hasMore,
  actorValue,
  groupValue,
  groups,
  onActorChange,
  onGroupChange,
  onShowMore,
  onRetry,
}: ActivitySectionProps) {
  return (
    <DashboardSection
      title="Activity log"
      count={total}
      state={state}
      onRetry={onRetry}
    >
      {total === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          No activity on this board yet.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Select
              value={actorValue}
              onValueChange={(value) =>
                onActorChange(value as ActivityActorFilter)
              }
            >
              <SelectTrigger aria-label="Actor" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTORS.map((actor) => (
                  <SelectItem key={actor.value} value={actor.value}>
                    {actor.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={groupValue} onValueChange={onGroupChange}>
              <SelectTrigger aria-label="Group" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border border-border bg-card">
            {rows.length === 0 ? (
              <p className="m-0 p-4 text-sm text-muted-foreground">
                No activity matches.
              </p>
            ) : (
              <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-96">
                <ItemGroup>
                  {rows.map((row) => (
                    <Item
                      key={row.id}
                      role="listitem"
                      size="sm"
                      className="flex-nowrap items-baseline border-0 border-b last:border-b-0"
                    >
                      <ItemContent className="min-w-0 flex-row gap-3">
                        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                          {row.time}
                        </span>
                        <span className="min-w-0 text-base wrap-anywhere text-foreground">
                          {row.line}
                        </span>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              </ScrollArea>
            )}
            {hasMore && (
              <div className="border-t border-border p-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onShowMore}
                >
                  Show more
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </DashboardSection>
  );
}
