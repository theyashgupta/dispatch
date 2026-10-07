import { useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { FilterOption } from "../../shared/types.js";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface MultiSelectProps {
  label: string;
  placeholder: string;
  options: FilterOption[];
  selected: string[];
  emptyText: string;
  onChange: (next: string[]) => void;
}

export function MultiSelect({
  label,
  placeholder,
  options,
  selected,
  emptyText,
  onChange,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id],
    );
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  const filteredOptions = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );
  const emptyCopy = options.length === 0 ? emptyText : "No matches";
  const hasSelection = selected.length > 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="w-full min-w-0 justify-between"
        >
          <span
            className={cn(
              "truncate",
              hasSelection ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {hasSelection ? `${selected.length} selected` : placeholder}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-48 p-0"
        onEscapeKeyDown={(event) => {
          if (search === "") return;
          event.preventDefault();
          setSearch("");
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search…"
            aria-label="Search options"
          />
          <CommandList aria-multiselectable="true">
            <CommandEmpty>{emptyCopy}</CommandEmpty>
            {filteredOptions.map((option) => (
              <CommandItem
                key={option.id}
                value={option.id}
                aria-checked={selected.includes(option.id)}
                onSelect={() => toggle(option.id)}
              >
                <CheckIcon
                  aria-hidden="true"
                  className={cn(
                    "size-4",
                    !selected.includes(option.id) && "invisible",
                  )}
                />
                <span className="truncate">{option.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
