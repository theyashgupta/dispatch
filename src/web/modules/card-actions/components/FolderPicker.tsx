import { useState, type ComponentProps } from "react";
import { ChevronDown, X } from "lucide-react";
import { WorkspaceAdd } from "@/components/WorkspaceAdd";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ModalFieldLabel } from "./ModalFieldLabel";

interface FolderPickerProps {
  folders: string[];
  selected: string | null;
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
  onAdd: (path: string) => Promise<string | null>;
  browser: ComponentProps<typeof WorkspaceAdd>["browser"];
}

export function FolderPicker({
  folders,
  selected,
  onSelect,
  onRemove,
  onAdd,
  browser,
}: FolderPickerProps) {
  const firstRun = folders.length === 0;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  async function addFolder(path: string): Promise<string | null> {
    const err = await onAdd(path);
    if (err === null) setAdding(false);
    return err;
  }

  return (
    <Field className="gap-1">
      <ModalFieldLabel htmlFor="start-workspace">Workspace</ModalFieldLabel>
      {firstRun || adding ? (
        <WorkspaceAdd
          onAdd={addFolder}
          browser={browser}
          hint={
            firstRun
              ? "Add a folder that contains the git repos for this ticket."
              : undefined
          }
        />
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id="start-workspace"
              type="button"
              variant="surface"
              size="sm"
              className="w-full justify-between font-mono text-sm font-normal has-[>svg]:px-2"
            >
              <span className="min-w-0 truncate">{selected}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) bg-card p-0"
          >
            <div className="scroll-stable-y flex max-h-60 flex-col overflow-y-auto">
              {folders.map((folder) => (
                <div
                  key={folder}
                  className="flex items-center gap-1 rounded-md hover:bg-accent"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-w-0 flex-1 justify-start px-2 font-mono text-sm font-normal hover:bg-transparent"
                    onClick={() => {
                      onSelect(folder);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{folder}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-md"
                    aria-label={`Remove folder ${folder}`}
                    className="text-muted-foreground hover:text-muted-foreground"
                    onClick={() => onRemove(folder)}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start rounded-md border-t border-border px-2 font-semibold text-muted-foreground"
                onClick={() => {
                  setAdding(true);
                  setOpen(false);
                }}
              >
                Add folder…
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </Field>
  );
}
