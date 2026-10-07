import type { FilterOption } from "../../../../shared/types.js";
import { MultiSelect } from "@/components/MultiSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActivityFilter } from "@/modules/activity/domain/activity-groups";

const ALL_CARDS = "__all__";

interface ActivityFilterBarProps {
  cardOptions: FilterOption[];
  typeOptions: FilterOption[];
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
}

export function ActivityFilterBar({
  cardOptions,
  typeOptions,
  filter,
  onFilterChange,
}: ActivityFilterBarProps) {
  return (
    <>
      <Select
        value={filter.cardId ?? ALL_CARDS}
        onValueChange={(value) =>
          onFilterChange({
            ...filter,
            cardId: value === ALL_CARDS ? null : value,
          })
        }
      >
        <SelectTrigger
          size="sm"
          aria-label="Filter by card"
          className="data-[size=sm]:h-7"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={ALL_CARDS}>All cards</SelectItem>
          {cardOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="w-fit">
        <MultiSelect
          label="Event types"
          placeholder="All types"
          options={typeOptions}
          selected={filter.types}
          emptyText="No events yet"
          onChange={(next) =>
            onFilterChange({
              ...filter,
              types: next as ActivityFilter["types"],
            })
          }
        />
      </div>
    </>
  );
}
