import type {
  AccountSessionEntry,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import { accountName } from "../../../../shared/session-account-view.js";
import { RunningSessionsList } from "@/modules/accounts/components/RunningSessionsList";
import { useSessionAccountMove } from "@/queries/session-account-queries";

interface RunningSessionsContainerProps {
  sessions: AccountSessionEntry[];
  accounts: ClaudeAccountSummary[];
  activeId: string;
}

export function RunningSessionsContainer({
  sessions,
  accounts,
  activeId,
}: RunningSessionsContainerProps) {
  const { notes, pending, move } = useSessionAccountMove();

  return (
    <RunningSessionsList
      sessions={sessions}
      accounts={accounts}
      notes={notes}
      pending={pending}
      onRestart={(session) =>
        move(
          session.sessionId,
          "restart",
          {
            cardId: session.cardId,
            accountId: session.accountId,
            sessionId: session.sessionId,
          },
          "Restarted",
        )
      }
      onContinue={(session) =>
        move(
          session.sessionId,
          "continue",
          {
            cardId: session.cardId,
            accountId: activeId,
            sessionId: session.sessionId,
          },
          `Moved to ${accountName(accounts, activeId)}`,
        )
      }
    />
  );
}
