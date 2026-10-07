import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { accountName } from "../../../../shared/session-account-view.js";
import { ChainRow } from "./ChainRow";
import { ChainDndContext } from "./dnd/ChainDndContext";
import { ChainDragRow } from "./dnd/ChainDragRow";

interface ChainListProps {
  accounts: ClaudeAccountSummary[];
  now: number;
  saving: boolean;
  onChange: (from: number, to: number) => void;
}

export function ChainList({ accounts, now, saving, onChange }: ChainListProps) {
  const ids = accounts.map((account) => account.id);
  return (
    <ChainDndContext ids={ids} onDrag={onChange}>
      <ul
        className="m-0 flex list-none flex-col gap-2 p-0"
        aria-label="Account chain"
        data-testid="account-chain"
      >
        {accounts.map((account, index) => {
          const name = accountName(accounts, account.id);
          return (
            <li key={account.id}>
              <ChainDragRow id={account.id} name={name} disabled={saving}>
                <ChainRow
                  account={account}
                  name={name}
                  now={now}
                  canMoveUp={index > 0 && !saving}
                  canMoveDown={index < accounts.length - 1 && !saving}
                  onMoveUp={() => onChange(index, index - 1)}
                  onMoveDown={() => onChange(index, index + 1)}
                />
              </ChainDragRow>
            </li>
          );
        })}
      </ul>
    </ChainDndContext>
  );
}
