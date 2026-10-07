import { useState } from "react";
import type {
  AccountSessionEntry,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import {
  accountName,
  type SessionNote,
} from "../../../../shared/session-account-view.js";
import { RunningSessionsList } from "@/modules/accounts/components/RunningSessionsList";
import { useSetSessionPinMutation } from "@/modules/accounts/queries/accounts-queries";
import { useSessionAccountMove } from "@/queries/session-account-queries";
import { useSingleFlight } from "@/queries/single-flight";

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
  const pin = useSetSessionPinMutation();
  const pinOnce = useSingleFlight(pin.mutate);
  const [pinNotes, setPinNotes] = useState<Record<string, SessionNote>>({});
  const [pinPending, setPinPending] = useState<string | null>(null);

  const changePin = (session: AccountSessionEntry, pinned: boolean) => {
    const { sessionId } = session;
    const note = (next: SessionNote | null) =>
      setPinNotes((prev) => {
        const rest = Object.fromEntries(
          Object.entries(prev).filter(([id]) => id !== sessionId),
        );
        return next ? { ...rest, [sessionId]: next } : rest;
      });
    setPinPending(sessionId);
    pinOnce(
      { cardId: session.cardId, sessionId, pinned },
      {
        onSuccess: (result) =>
          note(result.ok ? null : { tone: "error", text: result.error }),
        onError: () =>
          note({ tone: "error", text: "Couldn't change the pin." }),
        onSettled: () => setPinPending(null),
      },
    );
  };

  return (
    <RunningSessionsList
      sessions={sessions}
      accounts={accounts}
      notes={{ ...notes, ...pinNotes }}
      pending={
        pending ?? (pinPending ? { key: pinPending, kind: "pin" } : null)
      }
      onPinChange={changePin}
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
