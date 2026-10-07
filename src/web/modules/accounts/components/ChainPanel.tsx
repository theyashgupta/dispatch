import type {
  ChainExhaustedRecord,
  ChainMove,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { formatTimeLeft } from "@/modules/accounts/domain/countdown-format";
import { ChainHistory } from "./ChainHistory";
import { ChainList } from "./ChainList";
import {
  ChainSettings,
  type ChainSwitchNowControl,
  type ChainThresholdControl,
} from "./ChainSettings";

interface ChainPanelProps {
  accounts: ClaudeAccountSummary[];
  exhausted: ChainExhaustedRecord | null;
  history: ChainMove[];
  now: number;
  autoMove: boolean;
  orderSaving: boolean;
  orderErrorText: string | null;
  autoMovePending: boolean;
  autoMoveErrorText: string | null;
  threshold: ChainThresholdControl;
  switchNow: ChainSwitchNowControl;
  onOrderChange: (from: number, to: number) => void;
  onAutoMoveChange: (value: boolean) => void;
}

function exhaustedText(exhausted: ChainExhaustedRecord, now: number): string {
  if (exhausted.earliestResetAt === null) {
    return "Every account is at its limit. The earliest reset is unknown.";
  }
  const left = formatTimeLeft(exhausted.earliestResetAt, now);
  return left === null
    ? "Every account is at its limit. The earliest reset is due now."
    : `Every account is at its limit. The earliest reset is in ${left}.`;
}

export function ChainPanel({
  accounts,
  exhausted,
  history,
  now,
  autoMove,
  orderSaving,
  orderErrorText,
  autoMovePending,
  autoMoveErrorText,
  threshold,
  switchNow,
  onOrderChange,
  onAutoMoveChange,
}: ChainPanelProps) {
  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="chain-heading"
      data-testid="account-chain-section"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="chain-heading"
          className="text-sm font-semibold text-foreground"
        >
          Account chain
        </h2>
        <span className="text-xs text-muted-foreground">
          When the account in use reaches its limit, sessions move to the next
          available account in this order. Drag a row or use the arrows.
        </span>
      </div>
      {exhausted && (
        <p
          className="m-0 text-sm text-destructive-text"
          role="status"
          data-testid="chain-exhausted"
        >
          {exhaustedText(exhausted, now)}
        </p>
      )}
      <ChainList
        accounts={accounts}
        now={now}
        saving={orderSaving}
        onChange={onOrderChange}
      />
      {orderErrorText && <ErrorAlert>{orderErrorText}</ErrorAlert>}
      <ChainSettings
        autoMove={autoMove}
        autoMovePending={autoMovePending}
        autoMoveErrorText={autoMoveErrorText}
        threshold={threshold}
        switchNow={switchNow}
        onAutoMoveChange={onAutoMoveChange}
      />
      <ChainHistory moves={history} accounts={accounts} />
    </section>
  );
}
