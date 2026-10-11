import { useState, type ComponentProps } from "react";
import { ChevronRight } from "lucide-react";
import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { FolderBrowserDialog } from "@/components/FolderBrowserDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  BoardFormErrors,
  BoardFormValues,
  RepositoryValues,
} from "@/modules/boards/domain/board-form";
import { BoardRepositoryList } from "./BoardRepositoryList";

interface BoardFormDialogProps {
  values: BoardFormValues;
  errors: BoardFormErrors;
  failure: string | null;
  pending: boolean;
  placeholderKey: string;
  placeholderFolder: string;
  browser: ComponentProps<typeof FolderBrowserDialog>;
  onChange: (patch: Partial<Omit<BoardFormValues, "repositories">>) => void;
  onRepositoryChange: (index: number, patch: Partial<RepositoryValues>) => void;
  onAddRepository: () => void;
  onRemoveRepository: (index: number) => void;
  onBrowse: (index: number) => void;
  onUseKey: (key: string) => void;
  onKeyBlur: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function BoardFormDialog({
  values,
  errors,
  failure,
  pending,
  placeholderKey,
  placeholderFolder,
  browser,
  onChange,
  onRepositoryChange,
  onAddRepository,
  onRemoveRepository,
  onBrowse,
  onUseKey,
  onKeyBlur,
  onSubmit,
  onClose,
}: BoardFormDialogProps) {
  const returnFocus = useReturnFocus(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedError =
    errors.key !== undefined || errors.workspaceRoot !== undefined;
  const [advancedErrorSeen, setAdvancedErrorSeen] = useState(false);
  if (advancedError !== advancedErrorSeen) {
    setAdvancedErrorSeen(advancedError);
    if (advancedError) setAdvancedOpen(true);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={returnFocus}
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-160"
      >
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (advancedError) setAdvancedOpen(true);
            onSubmit();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="pr-8 wrap-anywhere">New board</DialogTitle>
          </DialogHeader>
          <div className="scroll-stable-y flex min-h-0 flex-col gap-4 overflow-y-auto p-1">
            <Field>
              <Label htmlFor="board-name">Name</Label>
              <Input
                id="board-name"
                value={values.name}
                aria-invalid={errors.name !== undefined}
                aria-describedby="board-name-error"
                onChange={(event) => onChange({ name: event.target.value })}
              />
              <FieldError id="board-name-error">{errors.name}</FieldError>
            </Field>
            <FieldSet className="gap-2">
              <FieldLegend variant="label">Repositories</FieldLegend>
              <BoardRepositoryList
                repositories={values.repositories}
                rowErrors={errors.repositoryRows}
                error={errors.repositories}
                onChange={onRepositoryChange}
                onAdd={onAddRepository}
                onRemove={onRemoveRepository}
                onBrowse={onBrowse}
              />
            </FieldSet>
            <Collapsible
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              className="flex flex-col gap-4"
            >
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start [&[data-state=open]>svg]:rotate-90"
                >
                  <ChevronRight aria-hidden="true" />
                  Advanced
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-4">
                <Field>
                  <Label htmlFor="board-key">Key</Label>
                  <Input
                    id="board-key"
                    className="font-mono"
                    value={values.key}
                    placeholder={placeholderKey}
                    aria-invalid={errors.key !== undefined}
                    aria-describedby="board-key-help board-key-error"
                    onChange={(event) => onChange({ key: event.target.value })}
                    onBlur={onKeyBlur}
                  />
                  <FieldDescription id="board-key-help">
                    2 to 6 capital letters or digits. It starts with a letter.
                    Leave it empty to use the key shown. You cannot change it
                    later.
                  </FieldDescription>
                  <FieldError id="board-key-error">
                    {errors.key}
                    {errors.keySuggestion !== undefined && (
                      <>
                        {" "}
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          onClick={() => onUseKey(errors.keySuggestion ?? "")}
                        >
                          {`Use ${errors.keySuggestion}`}
                        </Button>
                      </>
                    )}
                  </FieldError>
                </Field>
                <Field>
                  <Label htmlFor="board-root">Folder</Label>
                  <Input
                    id="board-root"
                    className="font-mono"
                    value={values.workspaceRoot}
                    placeholder={placeholderFolder}
                    aria-invalid={errors.workspaceRoot !== undefined}
                    aria-describedby="board-root-help board-root-error"
                    onChange={(event) =>
                      onChange({ workspaceRoot: event.target.value })
                    }
                  />
                  <FieldDescription id="board-root-help">
                    Dispatch makes one folder for each session in this folder.
                    Leave it empty to use the folder shown.
                  </FieldDescription>
                  <FieldError id="board-root-error">
                    {errors.workspaceRoot}
                  </FieldError>
                </Field>
                <Field>
                  <Label htmlFor="board-teams">Linear team keys</Label>
                  <Input
                    id="board-teams"
                    className="font-mono"
                    value={values.linearTeamKeys}
                    aria-describedby="board-teams-help"
                    onChange={(event) =>
                      onChange({ linearTeamKeys: event.target.value })
                    }
                  />
                  <FieldDescription id="board-teams-help">
                    New Linear issues of these teams go to this board. Separate
                    keys with a comma.
                  </FieldDescription>
                </Field>
              </CollapsibleContent>
            </Collapsible>
          </div>
          {failure !== null && (
            <ErrorAlert>
              {failure}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={onSubmit}
              >
                Try again
              </Button>
            </ErrorAlert>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <LoadingButton type="submit" loading={pending}>
              Create
            </LoadingButton>
          </DialogFooter>
        </form>
        <FolderBrowserDialog {...browser} />
      </DialogContent>
    </Dialog>
  );
}
