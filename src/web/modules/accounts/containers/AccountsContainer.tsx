import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
  const navigate = useNavigate();
  const [openedRouteId, setOpenedRouteId] = useState<string | undefined>();
  const [addTarget, setAddTarget] = useState<{
    account?: ClaudeAccountSummary;
    managedDefault?: boolean;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ClaudeAccountSummary | null>(
    null,
  );
  const [switchTarget, setSwitchTarget] = useState<ClaudeAccountSummary | null>(
    null,
  );
  const reload = useCallback(() => void refetch(), [refetch]);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const removeDuplicate = useRemoveAccountMutation();
  const removeDuplicateOnce = useSingleFlight(removeDuplicate.mutate);
  const routeAccount = accounts.data?.accounts.find(
    (a) => a.id === routeId && !a.isDefault,
  );

  if (routeId !== openedRouteId && (routeId === undefined || routeAccount)) {
    setOpenedRouteId(routeId);
    if (
      routeAccount?.state === "needs-login" ||
      routeAccount?.state === "login-expired"
    ) {
      setAddTarget({ account: routeAccount });
    }
  }

  useEffect(() => {
    if (routeAccount === undefined) return;
    void navigate({
      to: "/accounts/{-$id}",
      params: { id: undefined },
      replace: true,
    });
  }, [routeAccount, navigate]);

  return (
    <AccountsStack>
      <AccountsList
        accounts={accounts.data?.accounts ?? []}
        activeId={accounts.data?.activeId ?? ""}
        now={now}
        loaded={!accounts.isPending}
        failed={accounts.isError}
        removeError={removeError}
        addDisabled={addTarget?.account !== undefined}
        managedDefaultOffer={accounts.data?.managedDefaultOffer ?? false}
        onManagedLogin={() => setAddTarget({ managedDefault: true })}
        reloginDisabled={addTarget !== null}
        onAdd={() => setAddTarget({})}
        onSwitch={setSwitchTarget}
        onRelogin={(account) => setAddTarget({ account })}
        onRemove={setRemoveTarget}
        onRemoveDuplicate={(account) =>
          removeDuplicateOnce(account.id, {
            onSuccess: (result) =>
              setRemoveError(result.ok ? null : result.error),
            onError: () => setRemoveError("Couldn't remove the account."),
            onSettled: reload,
          })
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
          key={
            addTarget.account?.id ??
            (addTarget.managedDefault ? "managed" : "new")
          }
          accountId={addTarget.account?.id}
          accountEmail={addTarget.account?.email}
          managedDefault={addTarget.managedDefault}
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
