import { useEffect, useReducer, useRef, useState } from "react";
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
  commandsInGroup,
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
  initialGroup?: string;
  results: readonly CardSearchResult[];
  searchFailed: boolean;
  onQueryChange: (query: string) => void;
  onClose: (ran: boolean) => void;
  onOpenCard: (result: CardSearchResult) => void;
}

export function CommandPalette({
  commands,
  initialGroup,
  results,
  searchFailed,
  onQueryChange,
  onClose,
  onOpenCard,
}: CommandPaletteProps) {
  const [state, dispatch] = useReducer(paletteReducer, initialGroup, (group) =>
    group === undefined
      ? INITIAL_PALETTE
      : paletteReducer(INITIAL_PALETTE, { type: "open-group", group }),
  );
  const ranRef = useRef<"command" | "card" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const returnFocus = useReturnFocus();
  const prompt =
    commands.find((command) => command.id === state.promptId)?.prompt ?? null;

  useEffect(() => {
    if (prompt !== null && !submitting) inputRef.current?.focus();
  }, [prompt, submitting]);

  const shown =
    prompt === null
      ? filterCommands(commandsInGroup(commands, state.group), state.query)
      : [];
  const shownResults = prompt === null && state.group === null ? results : [];
  const values =
    prompt === null
      ? [
          ...shown.map((command) => `command:${command.id}`),
          ...shownResults.map((result) => `card:${result.id}`),
        ]
      : ["prompt:submit"];
  const count = values.length;
  const highlight = Math.min(state.highlight, count - 1);

  async function submitPrompt() {
    const text = state.query.trim();
    if (text === "" || prompt === null || submitting) return;
    setSubmitting(true);
    try {
      await prompt.submit(text);
    } finally {
      setSubmitting(false);
    }
  }

  function enterPrompt(command: PaletteCommand) {
    if (command.prompt === undefined) return;
    dispatch({ type: "enter-prompt", commandId: command.id });
    onQueryChange("");
  }

  function runAt(index: number) {
    const row = rowAt(shown, shownResults, index);
    if (row == null || ranRef.current != null) return;
    if (row.kind === "command" && row.command.prompt !== undefined) {
      enterPrompt(row.command);
      return;
    }
    ranRef.current = row.kind;
    onClose(row.kind === "command");
    if (row.kind === "command") void row.command.run();
    else onOpenCard(row.result);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose(ranRef.current === "command");
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="top-[15vh] translate-y-0 sm:max-w-[560px]"
        onEscapeKeyDown={(event) => {
          if (prompt === null) return;
          event.preventDefault();
          if (!submitting) dispatch({ type: "leave-prompt" });
        }}
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
            ref={inputRef}
            className="px-2"
            aria-label={prompt?.placeholder ?? "Search commands and tickets"}
            placeholder={prompt?.placeholder ?? "Type a command or a ticket…"}
            maxLength={SEARCH_QUERY_MAX}
            value={state.query}
            disabled={submitting}
            onValueChange={(query) => {
              dispatch({ type: "query", query });
              if (prompt === null && state.group === null) onQueryChange(query);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (prompt === null) runAt(highlight);
                else void submitPrompt();
              }
            }}
          />
          <CommandList className="max-h-[50vh]">
            {prompt !== null && state.query.trim() !== "" && (
              <CommandGroup>
                <CommandItem
                  value="prompt:submit"
                  onSelect={() => void submitPrompt()}
                  className="min-h-8 text-base"
                >
                  {prompt.hint}
                </CommandItem>
              </CommandGroup>
            )}
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
            {shownResults.length > 0 && (
              <CommandGroup heading="Tickets">
                {shownResults.map((result, i) => {
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
            {prompt !== null ? null : searchFailed ? (
              <p
                role="status"
                className="px-4 py-2 text-xs text-muted-foreground"
              >
                Ticket search failed
              </p>
            ) : shown.length + shownResults.length > 0 ? null : (
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
