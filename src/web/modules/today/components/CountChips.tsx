import { SourceBadge } from "@/components/badges/SourceBadge";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SourceCount } from "@/modules/today/domain/today-view";

interface CountChipsProps {
  chips: SourceCount[];
  filter: string | null;
  onFilterChange: (filter: string | null) => void;
}

export function CountChips({ chips, filter, onFilterChange }: CountChipsProps) {
  if (chips.length === 0) return null;
  return (
    <ToggleGroup
      type="multiple"
      role="group"
      rovingFocus={false}
      variant="outline"
      size="sm"
      spacing={2}
      aria-label="Filter by source"
      value={filter === null ? [] : [filter]}
      onValueChange={(values) =>
        onFilterChange(values.find((value) => value !== filter) ?? null)
      }
      className="w-full flex-wrap"
    >
      {chips.map(({ source, count }) => (
        <ToggleGroupItem
          key={source}
          id={`today-chip-${source}`}
          value={source}
          className="gap-1 border-border px-2 [&_svg:not([class*='size-'])]:size-3"
        >
          <SourceBadge source={source} label />
          <Badge
            variant="ghost"
            className="h-auto border-0 p-0 text-sm text-inherit"
          >
            {count}
          </Badge>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
