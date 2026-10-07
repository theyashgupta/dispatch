import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  BoardFormErrors,
  BoardFormValues,
  RepositoryValues,
} from "@/modules/boards/domain/board-form";
import { BoardRepositoryRow } from "./BoardRepositoryRow";

interface BoardFormDialogProps {
  mode: "create" | "edit";
  title: string;
  isDefault: boolean;
  values: BoardFormValues;
  errors: BoardFormErrors;
  clashingTeamKey: string | null;
  failure: string | null;
  pending: boolean;
  onChange: (patch: Partial<Omit<BoardFormValues, "repositories">>) => void;
  onRepositoryChange: (index: number, patch: Partial<RepositoryValues>) => void;
  onAddRepository: () => void;
  onRemoveRepository: (index: number) => void;
  onKeyBlur: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function BoardFormDialog({
  mode,
  title,
  isDefault,
  values,
  errors,
  clashingTeamKey,
  failure,
  pending,
  onChange,
  onRepositoryChange,
  onAddRepository,
  onRemoveRepository,
  onKeyBlur,
  onSubmit,
  onClose,
}: BoardFormDialogProps) {
  const returnFocus = useReturnFocus(true);
  const submitLabel = mode === "create" ? "Create board" : "Save";
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
            onSubmit();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="pr-8 wrap-anywhere">{title}</DialogTitle>
          </DialogHeader>
          <div className="scroll-stable-y flex min-h-0 flex-col gap-4 overflow-y-auto p-1">
            <Field>
              <Label htmlFor="board-key">Key</Label>
              <Input
                id="board-key"
                className="font-mono"
                value={values.key}
                readOnly={mode === "edit"}
                aria-invalid={errors.key !== undefined}
                aria-describedby="board-key-help board-key-error"
                onChange={(event) => onChange({ key: event.target.value })}
                onBlur={onKeyBlur}
              />
              <FieldDescription id="board-key-help">
                2 to 6 capital letters or digits. It starts with a letter. You
                cannot change it later.
              </FieldDescription>
              <FieldError id="board-key-error">{errors.key}</FieldError>
            </Field>
            {clashingTeamKey !== null && (
              <Alert>
                <AlertDescription>
                  {`Linear team ${clashingTeamKey} has the same key as this board. Dispatch skips each Linear issue whose id is already a card id.`}
                </AlertDescription>
              </Alert>
            )}
            {isDefault && (
              <Alert>
                <AlertDescription>
                  <p>
                    The default board reads its repositories from Settings,
                    Workspaces. A change here also changes that list. It picks
                    the base branch at each start and runs{" "}
                    <code>npm run check</code>.
                  </p>
                </AlertDescription>
              </Alert>
            )}
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
            <Field>
              <Label htmlFor="board-root">Sessions folder</Label>
              <Input
                id="board-root"
                className="font-mono"
                value={values.workspaceRoot}
                aria-invalid={errors.workspaceRoot !== undefined}
                aria-describedby="board-root-help board-root-error"
                onChange={(event) =>
                  onChange({ workspaceRoot: event.target.value })
                }
              />
              <FieldDescription id="board-root-help">
                Dispatch makes one folder for each session in this folder.
              </FieldDescription>
              <FieldError id="board-root-error">
                {errors.workspaceRoot}
              </FieldError>
            </Field>
            <div className="flex flex-col gap-2">
              {values.repositories.map((repository, index) => (
                <BoardRepositoryRow
                  key={index}
                  index={index}
                  values={repository}
                  pathOnly={isDefault}
                  onChange={(patch) => onRepositoryChange(index, patch)}
                  onRemove={() => onRemoveRepository(index)}
                />
              ))}
              <FieldError>{errors.repositories}</FieldError>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAddRepository}
                >
                  Add repository
                </Button>
              </div>
            </div>
            {!isDefault && (
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
            )}
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
              {submitLabel}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
