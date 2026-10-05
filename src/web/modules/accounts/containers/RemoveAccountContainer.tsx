import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { AccountRemoveDialog } from "@/modules/accounts/components/AccountRemoveDialog";
import { useRemoveAccountMutation } from "@/modules/accounts/queries/accounts-queries";
import { useSingleFlight } from "@/queries/single-flight";

interface RemoveAccountContainerProps {
  account: ClaudeAccountSummary;
  onClose: () => void;
}

export function RemoveAccountContainer({
  account,
  onClose,
}: RemoveAccountContainerProps) {
  const remove = useRemoveAccountMutation();
  const removeOnce = useSingleFlight(remove.mutate);

  const handleRemove = () => {
    removeOnce(account.id, {
      onSuccess: (result) => {
        if (result.ok) onClose();
      },
    });
  };

  return (
    <AccountRemoveDialog
      email={account.email}
      pending={remove.isPending}
      error={
        remove.isError
          ? "Couldn't remove the account."
          : remove.data?.ok === false
            ? remove.data.error
            : null
      }
      onClose={onClose}
      onRemove={handleRemove}
    />
  );
}
