import { useCallback, useState } from "react";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { AccountsList } from "@/modules/accounts/components/AccountsList";
import { AddAccountContainer } from "./AddAccountContainer";
import { RemoveAccountContainer } from "./RemoveAccountContainer";
import { useAccountsQuery } from "@/modules/accounts/queries/accounts-queries";

export function AccountsContainer() {
  const accounts = useAccountsQuery();
  const { refetch } = accounts;
  const [addTarget, setAddTarget] = useState<{
    account?: ClaudeAccountSummary;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ClaudeAccountSummary | null>(
    null,
  );
  const reload = useCallback(() => void refetch(), [refetch]);

  return (
    <>
      <AccountsList
        accounts={accounts.data?.accounts ?? []}
        activeId={accounts.data?.activeId ?? ""}
        loaded={!accounts.isPending}
        failed={accounts.isError}
        addDisabled={addTarget?.account !== undefined}
        reloginDisabled={addTarget !== null}
        onAdd={() => setAddTarget({})}
        onRelogin={(account) => setAddTarget({ account })}
        onRemove={setRemoveTarget}
      />

      {addTarget && (
        <AddAccountContainer
          accountId={addTarget.account?.id}
          accountEmail={addTarget.account?.email}
          onClose={() => {
            setAddTarget(null);
            reload();
          }}
          onAdded={reload}
        />
      )}
      {removeTarget && (
        <RemoveAccountContainer
          account={removeTarget}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </>
  );
}
