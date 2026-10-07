import { formatAge } from "../../../../shared/format-age.js";
import { SourceBadge } from "@/components/badges/SourceBadge";
import { Badge } from "@/components/ui/badge";
import { Item } from "@/components/ui/item";
import type { TodayEntry } from "@/modules/today/domain/p0";

interface EntryRowProps {
  entry: TodayEntry;
  id: string;
  number?: number;
  now: number;
  onOpen: (entry: TodayEntry) => void;
}

export function EntryRow({ entry, id, number, now, onOpen }: EntryRowProps) {
  return (
    <Item
      asChild
      size="sm"
      className="w-full cursor-pointer flex-nowrap rounded-none border-0 border-t border-border px-4 py-2 text-left leading-[normal] hover:bg-accent focus-visible:outline-offset-0"
    >
      <button type="button" id={id} onClick={() => onOpen(entry)}>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex w-full min-w-0 items-center gap-2 text-base leading-[normal] font-normal">
            {number != null && (
              <span className="shrink-0 text-sm leading-[normal] text-muted-foreground">
                {number}
              </span>
            )}
            <SourceBadge source={entry.source} />
            <span className="min-w-0 flex-auto truncate">{entry.title}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1">
            {entry.chips.map((chip, chipIndex) => (
              <Badge key={chipIndex} tone="neutral">
                {chip}
              </Badge>
            ))}
            <span className="text-sm leading-[normal] text-muted-foreground">
              {entry.actionLabel}
            </span>
            <span className="text-xs leading-[normal] text-muted-foreground">
              {formatAge(entry.time, now)}
            </span>
          </span>
        </span>
      </button>
    </Item>
  );
}
