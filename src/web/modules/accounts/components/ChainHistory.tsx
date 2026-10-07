import type {
  ChainMove,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import { moveReasonLabel } from "@/modules/accounts/domain/chain-state";
import { accountName } from "@/modules/accounts/domain/running-sessions";

interface ChainHistoryProps {
  moves: ChainMove[];
  accounts: ClaudeAccountSummary[];
}

export function ChainHistory({ moves, accounts }: ChainHistoryProps) {
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="chain-history-heading"
    >
      <h3
        id="chain-history-heading"
        className="text-sm font-semibold text-foreground"
      >
        Recent moves
      </h3>
      {moves.length === 0 ? (
        <span
          className="text-xs text-muted-foreground"
          data-testid="chain-history-empty"
        >
          No account moves yet.
        </span>
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-1 p-0"
          aria-label="Recent account moves"
          data-testid="chain-history"
        >
          {moves.map((move) => (
            <li
              key={`${move.at}-${move.from}-${move.to}`}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground"
              data-testid="chain-history-item"
            >
              <span className="min-w-0 text-sm break-words text-foreground">
                {accountName(accounts, move.from)} to{" "}
                {accountName(accounts, move.to)}
              </span>
              <span>{moveReasonLabel(move.reason)}</span>
              <time dateTime={move.at}>
                {new Date(move.at).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
