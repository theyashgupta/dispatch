import type { ContinueAction } from "../../shared/types.js";
import { LoadingButton } from "@/components/LoadingButton";

interface SessionContinueButtonProps {
  action: ContinueAction;
  pending: boolean;
  disabled?: boolean;
  onContinue: () => void;
}

export function SessionContinueButton({
  action,
  pending,
  disabled,
  onContinue,
}: SessionContinueButtonProps) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <LoadingButton
        variant="secondary"
        loading={pending}
        disabled={disabled}
        onClick={onContinue}
        data-testid="session-continue"
      >
        Continue on the active account
      </LoadingButton>
      {action === "usage-unknown" && (
        <span className="text-xs text-muted-foreground">Usage unknown</span>
      )}
    </span>
  );
}
