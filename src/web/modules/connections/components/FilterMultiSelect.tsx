import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FilterOption } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  filterOptions,
  selectionLabel,
  toggleId,
} from "@/modules/connections/domain/linear-filters";

interface FilterMultiSelectProps {
  label: string;
  placeholder: string;
  options: FilterOption[];
  selected: string[];
  loading: boolean;
  loadError: boolean;
  emptyText: string;
  onChange: (next: string[]) => void;
}

const MESSAGE = "px-2 py-2 text-base text-muted-foreground";

export function FilterMultiSelect({
  label,
  placeholder,
  options,
  selected,
  loading,
  loadError,
  emptyText,
  onChange,
}: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const showEmpty = !loading && (options.length === 0 || loadError);
  const filtered = filterOptions(options, search);
  const noMatches =
    !loading && !loadError && options.length > 0 && filtered.length === 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={label}
          className="w-full justify-between"
        >
          <span
            className={
              selected.length > 0
                ? "min-w-0 truncate text-sm"
                : "min-w-0 truncate text-sm text-muted-foreground"
            }
          >
            {selectionLabel(selected.length, placeholder)}
          </span>
          <ChevronDown aria-hidden="true" className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Search options"
            placeholder="Search…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading && <div className={MESSAGE}>Loading…</div>}
            {showEmpty && (
              <div className={MESSAGE}>
                {loadError ? "Couldn't load options" : emptyText}
              </div>
            )}
            {noMatches && <div className={MESSAGE}>No matches</div>}
            {!loading && !loadError && (
              <CommandGroup>
                {filtered.map((option) => {
                  const checked = selected.includes(option.id);
                  return (
                    <CommandItem
                      key={option.id}
                      value={option.id}
                      aria-checked={checked}
                      onSelect={() => onChange(toggleId(selected, option.id))}
                    >
                      <Checkbox
                        checked={checked}
                        tabIndex={-1}
                        aria-hidden="true"
                        className="pointer-events-none"
                      />
                      <span className="min-w-0 truncate">{option.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
