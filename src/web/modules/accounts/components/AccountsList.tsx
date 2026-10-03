import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { AccountRow } from "./AccountRow";

interface AccountsListProps {
  accounts: ClaudeAccountSummary[];
  activeId: string;
  loaded: boolean;
  failed: boolean;
  addDisabled: boolean;
  onAdd: () => void;
  onRelogin: (account: ClaudeAccountSummary) => void;
  onRemove: (account: ClaudeAccountSummary) => void;
  reloginDisabled: boolean;
}

export function AccountsList({
  accounts,
  activeId,
  loaded,
  failed,
  addDisabled,
  onAdd,
  onRelogin,
  onRemove,
  reloginDisabled,
}: AccountsListProps) {
  return (
    <div className="flex flex-col gap-4" data-testid="accounts-tab">
      <div className="flex justify-between gap-2">
        <span className="text-base text-foreground">
          Claude logins Dispatch can launch sessions on. The Default account is
          your own login on this Mac; added accounts keep their own Claude
          config directory.
        </span>
        <Button
          size="sm"
          className="px-4"
          onClick={onAdd}
          disabled={addDisabled}
        >
          Add account
        </Button>
      </div>

      {!loaded && (
        <span className="text-xs text-muted-foreground">Loading…</span>
      )}
      {failed && <ErrorAlert>Couldn't load Claude accounts.</ErrorAlert>}

      {loaded && (
        <div className="flex flex-col gap-2">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              active={account.id === activeId}
              reloginDisabled={reloginDisabled}
              onRelogin={() => onRelogin(account)}
              onRemove={() => onRemove(account)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
