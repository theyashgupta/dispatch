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
import type {
  OverrideErrors,
  OverrideOptions,
  OverrideValues,
} from "@/modules/orchestrator/domain/override-form";
import {
  NEEDS_SCOPE_HINT,
  type ScopeRow,
} from "@/modules/orchestrator/domain/ownership";
import { DialogFailure } from "./DialogFailure";
import { OverrideFields } from "./OverrideFields";

interface ExtraFormDialogProps {
  title: string;
  submitLabel: string;
  scopeRows: readonly ScopeRow[] | null;
  picked: readonly string[];
  values: OverrideValues;
  options: OverrideOptions;
  errors: OverrideErrors;
  canSubmit: boolean;
  failure: string | null;
  pending: boolean;
  onTogglePick: (id: string) => void;
  onChange: (patch: Partial<OverrideValues>) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function ExtraFormDialog({
  title,
  submitLabel,
  scopeRows,
  picked,
  values,
  options,
  errors,
  canSubmit,
  failure,
  pending,
  onTogglePick,
  onChange,
  onSubmit,
  onClose,
}: ExtraFormDialogProps) {
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
            {scopeRows !== null && (
              <fieldset className="m-0 flex min-w-0 flex-col gap-(--space-sm) border-0 p-0">
                <legend className="mb-(--space-sm) p-0 text-sm font-semibold text-foreground">
                  Scope
                </legend>
                {scopeRows.length === 0 && (
                  <p className="m-0 text-sm text-muted-foreground">
                    This board has no open group or ticket.
                  </p>
                )}
                {scopeRows.map((row) => (
                  <Label
                    key={row.id}
                    className="cursor-pointer items-start gap-2 text-sm font-normal"
                  >
                    <Checkbox
                      checked={picked.includes(row.id)}
                      disabled={row.ownedBy !== null}
                      onCheckedChange={() => onTogglePick(row.id)}
                    />
                    <span className="min-w-0 wrap-anywhere">{row.label}</span>
                    {row.ownedBy !== null && (
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {`Owned by ${row.ownedBy}`}
                      </span>
                    )}
                  </Label>
                ))}
                {picked.length === 0 && (
                  <p className="m-0 text-sm text-muted-foreground">
                    {NEEDS_SCOPE_HINT}
                  </p>
                )}
              </fieldset>
            )}
            <OverrideFields
              idPrefix={scopeRows === null ? "edit-override" : "extra-override"}
              values={values}
              options={options}
              errors={errors}
              onChange={onChange}
            />
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
              {submitLabel}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
