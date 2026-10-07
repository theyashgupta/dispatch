import { LoadingButton } from "@/components/LoadingButton";

interface SessionRestartButtonProps {
  pending: boolean;
  disabled?: boolean;
  label?: string;
  onRestart: () => void;
}

export function SessionRestartButton({
  pending,
  disabled,
  label,
  onRestart,
}: SessionRestartButtonProps) {
  return (
    <LoadingButton
      variant="secondary"
      loading={pending}
      disabled={disabled}
      onClick={onRestart}
      aria-label={label}
      data-testid="session-restart"
    >
      Restart
    </LoadingButton>
  );
}
