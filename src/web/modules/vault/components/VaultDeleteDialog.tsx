import { ConfirmDialog } from "@/components/ConfirmDialog";

interface VaultDeleteDialogProps {
  name: string;
  pending: boolean;
  failed: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export function VaultDeleteDialog({
  name,
  pending,
  failed,
  onClose,
  onDelete,
}: VaultDeleteDialogProps) {
  return (
    <ConfirmDialog
      label={`Delete ${name}`}
      title={name}
      titleClassName="font-mono"
      description="Delete this key? Any command that depends on it will stop finding the value. This can't be undone."
      error={failed ? "Couldn't delete key, try again." : null}
      cancelLabel="Keep key"
      confirmLabel="Delete key"
      pendingLabel="Deleting key..."
      confirmVariant="destructive"
      pending={pending}
      onClose={onClose}
      onConfirm={onDelete}
    />
  );
}
