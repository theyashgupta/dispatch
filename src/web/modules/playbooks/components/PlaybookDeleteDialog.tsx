import { ConfirmDialog } from "@/components/ConfirmDialog";

interface PlaybookDeleteDialogProps {
  name: string;
  pending: boolean;
  failed: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export function PlaybookDeleteDialog({
  name,
  pending,
  failed,
  onClose,
  onDelete,
}: PlaybookDeleteDialogProps) {
  return (
    <ConfirmDialog
      label={`Delete ${name}`}
      title={name}
      description="Delete this playbook? This can't be undone."
      error={failed ? "Couldn't delete playbook. Try again." : null}
      cancelLabel="Keep playbook"
      confirmLabel="Delete playbook"
      pendingLabel="Deleting playbook…"
      confirmVariant="destructive"
      pending={pending}
      onClose={onClose}
      onConfirm={onDelete}
    />
  );
}
