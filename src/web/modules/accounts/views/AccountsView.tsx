import { PageColumn } from "@/components/PageColumn";
import { AccountsContainer } from "@/modules/accounts/containers/AccountsContainer";

export function AccountsView() {
  return (
    <PageColumn>
      <AccountsContainer />
    </PageColumn>
  );
}
