import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EntryRow } from "./EntryRow";
import {
  P0_COUNTS,
  type TodayEntry,
  type TodayWindow,
} from "@/modules/today/domain/p0";

interface P0CardProps {
  entries: TodayEntry[];
  poolSize: number;
  range: TodayWindow;
  onRangeChange: (range: TodayWindow) => void;
  count: number;
  onCountChange: (count: number) => void;
  onOpen: (entry: TodayEntry) => void;
  now: number;
}

const WINDOW_ITEM = "border-border px-2 font-semibold";

export function P0Card({
  entries,
  poolSize,
  range,
  onRangeChange,
  count,
  onCountChange,
  onOpen,
  now,
}: P0CardProps) {
  return (
    <Card role="region" aria-label="P0" className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-(--space-lg)">
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="font-semibold text-foreground">P0</span>
          <span className="text-sm leading-(--line-body) text-muted-foreground">
            {entries.length} of {poolSize}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="multiple"
            role="group"
            rovingFocus={false}
            variant="outline"
            size="sm"
            spacing={1}
            aria-label="Window"
            value={[range]}
            onValueChange={(values) => {
              const next = values.find((value) => value !== range);
              if (next === "today" || next === "week") onRangeChange(next);
            }}
          >
            <ToggleGroupItem value="today" className={WINDOW_ITEM}>
              Today
            </ToggleGroupItem>
            <ToggleGroupItem value="week" className={WINDOW_ITEM}>
              This week
            </ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={String(count)}
            onValueChange={(value) => onCountChange(Number(value))}
          >
            <SelectTrigger size="sm" aria-label="Show" className="gap-1 px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {P0_COUNTS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="m-0 p-(--space-lg) text-base text-muted-foreground">
          Nothing needs you right now.
        </p>
      ) : (
        <ol role="list" className="m-0 flex list-none flex-col p-0">
          {entries.map((entry, index) => (
            <li key={entry.key}>
              <EntryRow
                entry={entry}
                id={`p0-row-${entry.key}`}
                number={index + 1}
                now={now}
                onOpen={onOpen}
              />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
