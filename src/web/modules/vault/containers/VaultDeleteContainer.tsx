import type { VaultKeySummary } from "../../../../shared/types.js";
import { VaultDeleteDialog } from "@/modules/vault/components/VaultDeleteDialog";
import { useDeleteVaultKeyMutation } from "@/modules/vault/queries/vault-queries";
import { useSingleFlight } from "@/queries/single-flight";

interface VaultDeleteContainerProps {
  keySummary: VaultKeySummary;
  onClose: () => void;
  onDeleted: () => void;
}

export function VaultDeleteContainer({
  keySummary,
  onClose,
  onDeleted,
}: VaultDeleteContainerProps) {
  const remove = useDeleteVaultKeyMutation();
  const removeOnce = useSingleFlight(remove.mutate);

  const handleDelete = () => {
    removeOnce(keySummary.name, {
      onSuccess: (result) => {
        if (result.ok) onDeleted();
      },
    });
  };

  return (
    <VaultDeleteDialog
      name={keySummary.name}
      pending={remove.isPending}
      failed={remove.isError || remove.data?.ok === false}
      onClose={onClose}
      onDelete={handleDelete}
    />
  );
}
