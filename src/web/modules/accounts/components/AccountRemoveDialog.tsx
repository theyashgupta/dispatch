import { ConfirmDialog } from "@/components/ConfirmDialog";

interface AccountRemoveDialogProps {
  email: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onRemove: () => void;
}

export function AccountRemoveDialog({
  email,
  pending,
  error,
  onClose,
  onRemove,
}: AccountRemoveDialogProps) {
  return (
    <ConfirmDialog
      label={`Remove ${email}`}
      title={email}
      description="Remove this account from Dispatch? Its Claude login is signed out and its config directory is deleted. Sessions already running on it keep going."
      descriptionClassName="text-base text-foreground"
      error={error}
      cancelLabel="Keep account"
      confirmLabel="Remove account"
      pendingLabel="Removing…"
      confirmVariant="destructive"
      pending={pending}
      onClose={onClose}
      onConfirm={onRemove}
    />
  );
}
