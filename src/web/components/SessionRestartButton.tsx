import { LoadingButton } from "@/components/LoadingButton";

interface SessionRestartButtonProps {
  pending: boolean;
  disabled?: boolean;
  onRestart: () => void;
}

export function SessionRestartButton({
  pending,
  disabled,
  onRestart,
}: SessionRestartButtonProps) {
  return (
    <LoadingButton
      variant="secondary"
      loading={pending}
      disabled={disabled}
      onClick={onRestart}
      data-testid="session-restart"
    >
      Restart
    </LoadingButton>
  );
}
