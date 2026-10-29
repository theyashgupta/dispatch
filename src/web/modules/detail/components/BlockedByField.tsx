import { useState } from "react";
import { Check, Circle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
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
import type {
  BlockerOption,
  BlockerRow,
} from "@/modules/detail/domain/blocked-by-field";

interface BlockedByFieldProps {
  blockers: BlockerRow[];
  options: BlockerOption[];
  pending: boolean;
  error: string | null;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}

export function BlockedByField({
  blockers,
  options,
  pending,
  error,
  onAdd,
  onRemove,
}: BlockedByFieldProps) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex flex-col gap-(--space-xs)">
      <span className="text-sm leading-(--line-label) font-medium text-muted-foreground">
        Blocked by
      </span>
      {blockers.length === 0 && (
        <span className="text-sm text-muted-foreground">No blockers</span>
      )}
      {blockers.map((blocker) => (
        <div
          key={blocker.id}
          className="flex min-w-0 items-center gap-(--space-xs)"
        >
          {blocker.open ? (
            <Circle
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="Open"
            />
          ) : (
            <Check
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="Done"
            />
          )}
          <span className="font-mono text-xs font-semibold whitespace-nowrap text-muted-foreground">
            {blocker.identifier}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {blocker.title}
          </span>
          <Button
            variant="ghost"
            size="icon-md"
            disabled={pending}
            aria-label={`Remove blocker ${blocker.identifier}`}
            onClick={() => onRemove(blocker.id)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={pending}
          >
            <Plus className="size-3" aria-hidden="true" />
            Add blocker
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput
              aria-label="Search cards"
              placeholder="Search by identifier or title"
            />
            <CommandList>
              <CommandEmpty>No cards found</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={`${option.identifier} ${option.title}`}
                    onSelect={() => {
                      setPicking(false);
                      onAdd(option.id);
                    }}
                  >
                    <span className="font-mono text-xs font-semibold whitespace-nowrap text-muted-foreground">
                      {option.identifier}
                    </span>
                    <span className="min-w-0 truncate">{option.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error != null && (
        <div role="alert" className="text-sm text-destructive-text">
          {error}
        </div>
      )}
    </div>
  );
}
