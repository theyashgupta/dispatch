import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ApplyChoice } from "../../../../shared/types.js";

const CHOICES: { value: ApplyChoice; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "Only new sessions use it." },
  {
    value: "idle",
    label: "Idle sessions",
    hint: "Move sessions that are idle or at a usage limit now.",
  },
  {
    value: "all",
    label: "All sessions",
    hint: "Also move working sessions when their turn ends.",
  },
];

interface AccountSwitchDialogProps {
  targetName: string;
  counts: Record<ApplyChoice, number>;
  choice: ApplyChoice;
  pending: boolean;
  error: string | null;
  result: string | null;
  onChoiceChange: (choice: ApplyChoice) => void;
  onClose: () => void;
  onConfirm: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function AccountSwitchDialog({
  targetName,
  counts,
  choice,
  pending,
  error,
  result,
  onChoiceChange,
  onClose,
  onConfirm,
  onCloseAutoFocus,
}: AccountSwitchDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        data-testid="account-switch-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="min-w-0 pr-6 break-words">
            Switch to {targetName}
          </DialogTitle>
          <DialogDescription>
            New sessions use this account. Choose which running sessions follow
            it.
          </DialogDescription>
        </DialogHeader>
        {result === null ? (
          <ToggleGroup
            type="single"
            spacing={2}
            value={choice}
            onValueChange={(next) => {
              if (next) onChoiceChange(next as ApplyChoice);
            }}
            aria-label="Running sessions that follow the switch"
            className="w-full flex-col items-stretch"
          >
            {CHOICES.map(({ value, label, hint }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                disabled={pending}
                data-testid={`switch-choice-${value}`}
                className="h-auto w-full items-start justify-between gap-3 rounded-md border border-border py-2 text-left whitespace-normal"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>{label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {hint}
                  </span>
                </span>
                <span
                  className="shrink-0 text-xs font-semibold"
                  data-testid={`switch-count-${value}`}
                >
                  {counts[value] === 1
                    ? "1 session"
                    : `${counts[value]} sessions`}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <p
            role="status"
            className="text-sm text-foreground"
            data-testid="switch-result"
          >
            {result}
          </p>
        )}
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <DialogFooter>
          {result === null ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <LoadingButton loading={pending} onClick={onConfirm}>
                {pending ? "Switching…" : "Switch account"}
              </LoadingButton>
            </>
          ) : (
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
