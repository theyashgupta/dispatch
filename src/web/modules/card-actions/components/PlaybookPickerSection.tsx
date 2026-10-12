import { TriangleAlert } from "lucide-react";
import type { InvalidPlaybook, Playbook } from "../../../../shared/types.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModalFieldLabel } from "./ModalFieldLabel";

export interface PlaybookPickerModel {
  seedRows: Playbook[];
  restRows: Playbook[];
  invalidRows: InvalidPlaybook[];
  selected: string | null;
  lastUsed: string | null;
  onSelect: (name: string) => void;
}

interface PlaybookPickerSectionProps {
  playbook: PlaybookPickerModel;
  onEditPlaybooks: () => void;
}

export function PlaybookPickerSection({
  playbook,
  onEditPlaybooks,
}: PlaybookPickerSectionProps) {
  const { seedRows, restRows, invalidRows, selected, lastUsed } = playbook;
  const renderRow = (row: Playbook) => (
    <SelectItem
      key={row.slug ?? row.name}
      value={row.name}
      textValue={row.name}
      className="cursor-pointer"
    >
      <span className="flex min-w-0 flex-auto flex-col">
        <span className="truncate [contain:inline-size]">{row.name}</span>
        {row.when && (
          <span className="text-sm font-normal wrap-anywhere whitespace-normal text-muted-foreground">
            {row.when}
          </span>
        )}
      </span>
      {row.name === lastUsed && (
        <span className="text-sm leading-(--line-label) font-normal text-muted-foreground">
          Default
        </span>
      )}
    </SelectItem>
  );
  return (
    <Field className="flex-none gap-1">
      <div className="flex items-center justify-between">
        <ModalFieldLabel htmlFor="start-playbook">Playbook</ModalFieldLabel>
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 text-sm leading-(--line-label) font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
          onClick={onEditPlaybooks}
        >
          Edit in Settings
        </Button>
      </div>
      <Select value={selected ?? ""} onValueChange={playbook.onSelect}>
        <SelectTrigger
          id="start-playbook"
          size="sm"
          variant="surface"
          className="w-full cursor-pointer text-base"
        >
          <SelectValue placeholder="None selected">{selected}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-60 max-w-[min(28rem,calc(100vw-20px))] rounded-md">
          {seedRows.map(renderRow)}
          {seedRows.length > 0 && restRows.length > 0 && <SelectSeparator />}
          {restRows.map(renderRow)}
          {invalidRows.map((row) => (
            <SelectItem
              key={`invalid-${row.name}`}
              value={`invalid-${row.name}`}
              textValue={row.name}
              disabled
            >
              <TriangleAlert aria-hidden="true" />
              <span className="min-w-0 flex-auto truncate text-muted-foreground">
                {`${row.name} (${row.reason})`}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {seedRows.length === 0 && restRows.length === 0 && (
        <Alert variant="muted" role="status" className="mt-4">
          <AlertTitle className="leading-(--line-label)">
            No playbooks available
          </AlertTitle>
          <AlertDescription>
            Starting without one. Manage playbooks in Settings ▸ Playbooks.
          </AlertDescription>
        </Alert>
      )}
    </Field>
  );
}
