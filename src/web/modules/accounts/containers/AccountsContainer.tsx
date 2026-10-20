import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { AccountsList } from "@/modules/accounts/components/AccountsList";
import { AccountsStack } from "@/modules/accounts/components/AccountsStack";
import { ChainContainer } from "./ChainContainer";
import { AccountSwitchContainer } from "./AccountSwitchContainer";
import { AddAccountContainer } from "./AddAccountContainer";
import { RemoveAccountContainer } from "./RemoveAccountContainer";
import { RunningSessionsContainer } from "./RunningSessionsContainer";
import { useNow } from "@/modules/accounts/hooks/use-now";
import { useRemoveAccountMutation } from "@/modules/accounts/queries/accounts-queries";
import { useSingleFlight } from "@/queries/single-flight";
import { useAccountsQuery } from "@/queries/accounts-queries";

const EXPIRY_TICK_MS = 60_000;

export function AccountsContainer() {
  const now = useNow(EXPIRY_TICK_MS);
  const accounts = useAccountsQuery();
  const { refetch } = accounts;
  const { id: routeId } = useParams({ from: "/accounts/{-$id}" });
  const handledRouteId = useRef<string | null>(null);
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
  const removeDuplicate = useRemoveAccountMutation();
  const removeDuplicateOnce = useSingleFlight(removeDuplicate.mutate);
  const routeAccount = accounts.data?.accounts.find(
    (a) => a.id === routeId && !a.isDefault,
  );

  useEffect(() => {
    if (
      routeAccount === undefined ||
      handledRouteId.current === routeAccount.id
    )
      return;
    handledRouteId.current = routeAccount.id;
    setAddTarget({ account: routeAccount });
  }, [routeAccount]);

  return (
    <AccountsStack>
      <AccountsList
        accounts={accounts.data?.accounts ?? []}
        activeId={accounts.data?.activeId ?? ""}
        now={now}
        loaded={!accounts.isPending}
        failed={accounts.isError}
        addDisabled={addTarget?.account !== undefined}
        reloginDisabled={addTarget !== null}
        onAdd={() => setAddTarget({})}
        onSwitch={setSwitchTarget}
        onRelogin={(account) => setAddTarget({ account })}
        onRemove={setRemoveTarget}
        onRemoveDuplicate={(account) =>
          removeDuplicateOnce(account.id, { onSettled: reload })
        }
      />

      {accounts.data && (
        <ChainContainer
          accounts={accounts.data.accounts}
          chain={accounts.data.chain}
        />
      )}

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
