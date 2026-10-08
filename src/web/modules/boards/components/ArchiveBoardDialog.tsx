import { ConfirmDialog } from "@/components/ConfirmDialog";

interface ArchiveBoardDialogProps {
  name: string;
  pending: boolean;
  onClose: () => void;
  onArchive: () => void;
}

export function ArchiveBoardDialog({
  name,
  pending,
  onClose,
  onArchive,
}: ArchiveBoardDialogProps) {
  const title = `Archive board ${name}?`;
  return (
    <ConfirmDialog
      label={title}
      title={title}
      description="The board leaves the switcher. Its cards and sessions stay. You can restore it from Archived boards."
      cancelLabel="Cancel"
      confirmLabel="Archive board"
      pendingLabel="Archive board"
      pending={pending}
      onClose={onClose}
      onConfirm={onArchive}
    />
  );
}
