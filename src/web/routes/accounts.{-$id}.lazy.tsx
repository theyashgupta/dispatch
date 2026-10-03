import { createLazyFileRoute } from "@tanstack/react-router";
import { AccountsView } from "@/modules/accounts";

export const Route = createLazyFileRoute("/accounts/{-$id}")({
  component: AccountsView,
});
