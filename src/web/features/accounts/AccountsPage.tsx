import type { ClaudeAccountsState } from "../../hooks/useClaudeAccounts.js";
import { PageBody } from "../../primitives/PageBody.js";
import { AccountsTab } from "./AccountsTab.js";

interface AccountsPageProps {
  claudeAccounts: ClaudeAccountsState;
}

export function AccountsPage({ claudeAccounts }: AccountsPageProps) {
  return (
    <PageBody>
      <AccountsTab claudeAccounts={claudeAccounts} />
    </PageBody>
  );
}
