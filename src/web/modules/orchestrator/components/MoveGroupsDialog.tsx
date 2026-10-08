import { LoadingButton } from "@/components/LoadingButton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";
import { Label } from "@/components/ui/label";
import type { SelectOption } from "@/modules/orchestrator/domain/orchestrator-models";
import { DialogFailure } from "./DialogFailure";
import { SelectField } from "./SelectField";

interface MoveGroupsDialogProps {
  title: string;
  groups: readonly { id: string; label: string }[];
  picked: readonly string[];
  targets: readonly SelectOption[];
  target: string;
  blocked: string | null;
  failure: string | null;
  pending: boolean;
  canSubmit: boolean;
  onTogglePick: (id: string) => void;
  onTargetChange: (id: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function MoveGroupsDialog({
  title,
  groups,
  picked,
  targets,
  target,
  blocked,
  failure,
  pending,
  canSubmit,
  onTogglePick,
  onTargetChange,
  onSubmit,
  onClose,
}: MoveGroupsDialogProps) {
  const returnFocus = useReturnFocus(true);
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
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-120"
      >
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onSubmit();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="pr-8 wrap-anywhere">{title}</DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>
          </DialogHeader>
          <div className="scroll-stable-y flex min-h-0 flex-col gap-4 overflow-y-auto p-1">
            <fieldset className="m-0 flex min-w-0 flex-col gap-(--space-sm) border-0 p-0">
              <legend className="mb-(--space-sm) p-0 text-sm font-semibold text-foreground">
                Groups
              </legend>
              {groups.map((group) => (
                <Label
                  key={group.id}
                  className="cursor-pointer items-start gap-2 text-sm font-normal"
                >
                  <Checkbox
                    checked={picked.includes(group.id)}
                    onCheckedChange={() => onTogglePick(group.id)}
                  />
                  <span className="min-w-0 wrap-anywhere">{group.label}</span>
                </Label>
              ))}
            </fieldset>
            <SelectField
              id="move-groups-target"
              label="New owner"
              value={target}
              options={targets}
              onChange={onTargetChange}
            />
            {blocked !== null && (
              <p className="m-0 text-sm text-muted-foreground">{blocked}</p>
            )}
          </div>
          {failure !== null && (
            <DialogFailure
              message={failure}
              pending={pending}
              onRetry={onSubmit}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <LoadingButton
              type="submit"
              loading={pending}
              disabled={!canSubmit}
            >
              Move groups
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
