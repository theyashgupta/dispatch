import { useState } from "react";
import type {
  AccountSessionEntry,
  ApplyChoice,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import { AccountSwitchDialog } from "@/modules/accounts/components/AccountSwitchDialog";
import { accountName } from "@/modules/accounts/domain/running-sessions";
import {
  resultNotice,
  switchCounts,
} from "@/modules/accounts/domain/switch-counts";
import { useSetActiveAccountMutation } from "@/modules/accounts/queries/accounts-queries";
import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";
import { useSingleFlight } from "@/queries/single-flight";

interface AccountSwitchContainerProps {
  target: ClaudeAccountSummary;
  sessions: AccountSessionEntry[];
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function AccountSwitchContainer({
  target,
  sessions,
  onClose,
  onCloseAutoFocus,
}: AccountSwitchContainerProps) {
  const [choice, setChoice] = useState<ApplyChoice>("idle");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const switchAccount = useSetActiveAccountMutation();
  const switchOnce = useSingleFlight(switchAccount.mutate);
  const returnFocus = useReturnFocus(true);

  const handleConfirm = () => {
    setError(null);
    switchOnce(
      { id: target.id, applyToRunning: choice },
      {
        onSuccess: (outcome) => {
          if (!outcome.ok) {
            setError(outcome.error);
            return;
          }
          setResult(
            choice === "none"
              ? "Switched. Running sessions stay where they are."
              : resultNotice(outcome.moved, outcome.queued, outcome.skipped),
          );
        },
        onError: () => setError("Couldn't switch the Claude account."),
      },
    );
  };

  return (
    <AccountSwitchDialog
      targetName={accountName([target], target.id)}
      counts={switchCounts(sessions, target.id)}
      choice={choice}
      pending={switchAccount.isPending}
      error={error}
      result={result}
      onChoiceChange={setChoice}
      onClose={onClose}
      onConfirm={handleConfirm}
      onCloseAutoFocus={onCloseAutoFocus ?? returnFocus}
    />
  );
}
