import { createLazyFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "@/features/accounts";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/accounts/{-$id}")({
  component: AccountsRoute,
});

function AccountsRoute() {
  const props = useAppState().accounts;
  return <AccountsPage {...props} />;
}
