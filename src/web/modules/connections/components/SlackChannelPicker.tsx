import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { SlackChannel } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LoadingButton } from "@/components/LoadingButton";
import {
  filterChannelRows,
  samePicked,
  SLACK_PICK_MAX,
  SLACK_SETUP_COPY,
  type SlackChannelRow,
  type SlackSetupFailure,
} from "@/modules/connections/domain/slack-channels";
import { selectionLabel } from "@/modules/connections/domain/linear-filters";

interface SlackChannelPickerProps {
  enabled: boolean;
  saved: SlackChannel[];
  picked: SlackChannel[];
  rows: SlackChannelRow[];
  truncated: boolean;
  listFailure: SlackSetupFailure | null;
  loadFailed: boolean;
  addError: SlackSetupFailure | null;
  saveFailed: boolean;
  busy: boolean;
  onToggle: (row: SlackChannelRow) => void;
  onAdd: (input: string) => Promise<boolean>;
  onClearAddError: () => void;
  onSave: () => void;
}

const SECTION_LABEL = "text-sm font-medium text-muted-foreground";
const NOTE = "m-0 text-sm text-muted-foreground [overflow-wrap:anywhere]";

export function SlackChannelPicker({
  enabled,
  saved,
  picked,
  rows,
  truncated,
  listFailure,
  loadFailed,
  addError,
  saveFailed,
  busy,
  onToggle,
  onAdd,
  onClearAddError,
  onSave,
}: SlackChannelPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [paste, setPaste] = useState("");

  const pickedIds = new Set(picked.map((c) => c.id));
  const visible = filterChannelRows(rows, filter);

  const handleAdd = async () => {
    if (await onAdd(paste)) setPaste("");
  };

  if (!enabled) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <span className={SECTION_LABEL}>Channels to watch</span>
        <p className={NOTE}>Turn on Poll Slack to pick channels.</p>
        {saved.length > 0 && (
          <p className={NOTE}>{saved.map((c) => `#${c.name}`).join(", ")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={SECTION_LABEL}>Channels to watch</span>
      {listFailure && <p className={NOTE}>{SLACK_SETUP_COPY[listFailure]}</p>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Channels to watch"
            className="w-full justify-between"
          >
            <span className="min-w-0 truncate">
              {selectionLabel(picked.length, "Channels to watch")}
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
              aria-label="Filter channels"
              placeholder="Filter channels"
              value={filter}
              onValueChange={setFilter}
            />
            <CommandList>
              <CommandGroup>
                {visible.map((row) => {
                  const checked = pickedIds.has(row.id);
                  return (
                    <CommandItem
                      key={row.id}
                      value={row.id}
                      disabled={busy}
                      aria-checked={checked}
                      onSelect={() => onToggle(row)}
                    >
                      <Checkbox
                        checked={checked}
                        tabIndex={-1}
                        aria-hidden="true"
                        className="pointer-events-none"
                      />
                      <span className="min-w-0 truncate">
                        #{row.name}
                        {row.notListed && !listFailure ? " (not listed)" : ""}
                      </span>
                      {row.private && <Badge tone="neutral">private</Badge>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {truncated && (
        <p className={NOTE}>Only the first 1000 channels are listed.</p>
      )}
      <div className="flex min-w-0 flex-wrap gap-2">
        <Input
          aria-label="Channel link or ID"
          placeholder="Channel link or ID"
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            onClearAddError();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && paste.trim() !== "") {
              void handleAdd();
            }
          }}
          className="h-8 w-auto min-w-0 flex-[1_1_200px] text-base md:text-base"
        />
        <LoadingButton
          variant="secondary"
          disabled={busy || paste.trim() === ""}
          onClick={() => void handleAdd()}
        >
          Add
        </LoadingButton>
      </div>
      {addError && <p className={NOTE}>{SLACK_SETUP_COPY[addError]}</p>}
      {loadFailed && (
        <p className={NOTE}>
          Couldn't load the saved channels. Reload Settings to try again.
        </p>
      )}
      {picked.length > SLACK_PICK_MAX && (
        <p className={NOTE}>Pick at most 200 channels.</p>
      )}
      {saveFailed && (
        <p className={NOTE}>Couldn't save the channels. Try again.</p>
      )}
      <div>
        <LoadingButton
          loading={busy}
          disabled={
            busy ||
            loadFailed ||
            picked.length > SLACK_PICK_MAX ||
            samePicked(picked, saved)
          }
          onClick={onSave}
        >
          Save channels
        </LoadingButton>
      </div>
    </div>
  );
}
