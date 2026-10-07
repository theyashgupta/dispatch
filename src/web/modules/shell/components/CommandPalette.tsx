import { useReducer, useRef } from "react";
import type { CardSearchResult } from "../../../../shared/search.js";
import { SEARCH_QUERY_MAX } from "../../../../shared/search.js";
import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  filterCommands,
  groupCommands,
  type Command as PaletteCommand,
} from "@/modules/shell/domain/commands";
import {
  INITIAL_PALETTE,
  paletteReducer,
  rowAt,
} from "@/modules/shell/domain/palette-state";
import { useReturnFocus } from "@/modules/shell/hooks/use-return-focus";

interface CommandPaletteProps {
  commands: readonly PaletteCommand[];
  results: readonly CardSearchResult[];
  searchFailed: boolean;
  onQueryChange: (query: string) => void;
  onClose: (ran: boolean) => void;
  onOpenCard: (result: CardSearchResult) => void;
}

export function CommandPalette({
  commands,
  results,
  searchFailed,
  onQueryChange,
  onClose,
  onOpenCard,
}: CommandPaletteProps) {
  const [state, dispatch] = useReducer(paletteReducer, INITIAL_PALETTE);
  const ranRef = useRef<"command" | "card" | null>(null);
  const returnFocus = useReturnFocus();

  const shown = filterCommands(commands, state.query);
  const values = [
    ...shown.map((command) => `command:${command.id}`),
    ...results.map((result) => `card:${result.id}`),
  ];
  const count = values.length;
  const highlight = Math.min(state.highlight, count - 1);

  function runAt(index: number) {
    const row = rowAt(shown, results, index);
    if (row == null || ranRef.current != null) return;
    ranRef.current = row.kind;
    onClose(row.kind === "command");
    if (row.kind === "command") void row.command.run();
    else onOpenCard(row.result);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose(ranRef.current === "command");
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="top-[15vh] translate-y-0 sm:max-w-[560px]"
        onCloseAutoFocus={(event) => {
          if (ranRef.current === "command") event.preventDefault();
          else returnFocus(event);
        }}
      >
        <DialogHeader>
          <DialogTitle>Command palette</DialogTitle>
        </DialogHeader>
        <Command
          shouldFilter={false}
          value={values[highlight]}
          onValueChange={(value) => {
            const index = values.indexOf(value);
            if (index >= 0) {
              dispatch({ type: "move", delta: index - highlight, count });
            }
          }}
        >
          <CommandInput
            className="px-2"
            aria-label="Search commands and tickets"
            placeholder="Type a command or a ticket…"
            maxLength={SEARCH_QUERY_MAX}
            value={state.query}
            onValueChange={(query) => {
              dispatch({ type: "query", query });
              onQueryChange(query);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                runAt(highlight);
              }
            }}
          />
          <CommandList className="max-h-[50vh]">
            {groupCommands(shown).map((section) => (
              <CommandGroup
                key={section.heading ?? ""}
                heading={section.heading}
              >
                {section.rows.map(({ command, index }) => (
                  <CommandItem
                    key={command.id}
                    value={values[index]}
                    onSelect={() => runAt(index)}
                    className="min-h-8 text-base"
                  >
                    <span className="flex-1">{command.label}</span>
                    {command.key && <Kbd>{command.key}</Kbd>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {results.length > 0 && (
              <CommandGroup heading="Tickets">
                {results.map((result, i) => {
                  const index = shown.length + i;
                  return (
                    <CommandItem
                      key={result.id}
                      value={values[index]}
                      onSelect={() => runAt(index)}
                      className="min-h-8 text-base"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {result.identifier}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {result.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {COLUMN_LABELS[result.column]}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {searchFailed ? (
              <p
                role="status"
                className="px-4 py-2 text-xs text-muted-foreground"
              >
                Ticket search failed
              </p>
            ) : (
              <CommandEmpty>
                <p role="status" className="m-0">
                  No matching commands or tickets
                </p>
              </CommandEmpty>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
