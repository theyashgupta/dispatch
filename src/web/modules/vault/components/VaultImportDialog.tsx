import { ConfirmDialog } from "@/components/ConfirmDialog";

interface VaultImportDialogProps {
  pending: boolean;
  onClose: () => void;
  onImport: () => void;
}

export function VaultImportDialog({
  pending,
  onClose,
  onImport,
}: VaultImportDialogProps) {
  return (
    <ConfirmDialog
      label="Import keys from env-vault?"
      title="Import keys from env-vault?"
      description="This copies key names, purposes, and values from your standalone env-vault. Keys already here are skipped, never overwritten, and the original files are left untouched."
      cancelLabel="Cancel import"
      confirmLabel="Import keys"
      pendingLabel="Importing keys..."
      pending={pending}
      onClose={onClose}
      onConfirm={onImport}
    />
  );
}
