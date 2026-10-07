import { useCallback, useState } from "react";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { AccountsList } from "@/modules/accounts/components/AccountsList";
import { AccountsStack } from "@/modules/accounts/components/AccountsStack";
import { AccountSwitchContainer } from "./AccountSwitchContainer";
import { AddAccountContainer } from "./AddAccountContainer";
import { RemoveAccountContainer } from "./RemoveAccountContainer";
import { RunningSessionsContainer } from "./RunningSessionsContainer";
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
  const [switchTarget, setSwitchTarget] = useState<ClaudeAccountSummary | null>(
    null,
  );
  const reload = useCallback(() => void refetch(), [refetch]);

  return (
    <AccountsStack>
      <AccountsList
        accounts={accounts.data?.accounts ?? []}
        activeId={accounts.data?.activeId ?? ""}
        loaded={!accounts.isPending}
        failed={accounts.isError}
        addDisabled={addTarget?.account !== undefined}
        reloginDisabled={addTarget !== null}
        onAdd={() => setAddTarget({})}
        onSwitch={setSwitchTarget}
        onRelogin={(account) => setAddTarget({ account })}
        onRemove={setRemoveTarget}
      />

      {accounts.data && (
        <RunningSessionsContainer
          sessions={accounts.data.sessions}
          accounts={accounts.data.accounts}
          activeId={accounts.data.activeId}
        />
      )}

      {switchTarget && (
        <AccountSwitchContainer
          target={switchTarget}
          sessions={accounts.data?.sessions ?? []}
          onClose={() => setSwitchTarget(null)}
        />
      )}
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
    </AccountsStack>
  );
}
