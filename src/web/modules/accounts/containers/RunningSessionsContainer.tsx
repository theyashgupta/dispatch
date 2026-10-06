import { useState } from "react";
import type {
  AccountSessionEntry,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import {
  RunningSessionsList,
  type SessionNote,
} from "@/modules/accounts/components/RunningSessionsList";
import { accountName } from "@/modules/accounts/domain/running-sessions";
import { useSetSessionPinMutation } from "@/modules/accounts/queries/accounts-queries";
import { useMoveSessionAccountMutation } from "@/queries/session-account-queries";
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
  const move = useMoveSessionAccountMutation();
  const moveOnce = useSingleFlight(move.mutate);
  const pin = useSetSessionPinMutation();
  const pinOnce = useSingleFlight(pin.mutate);
  const [notes, setNotes] = useState<Record<string, SessionNote>>({});
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  const run = (
    session: AccountSessionEntry,
    accountId: string,
    movedText: string,
  ) => {
    const note = (next: SessionNote) =>
      setNotes((prev) => ({ ...prev, [session.sessionId]: next }));
    setPendingSessionId(session.sessionId);
    moveOnce(
      {
        cardId: session.cardId,
        accountId,
        sessionId: session.sessionId,
      },
      {
        onSuccess: (result) => {
          if (!result.ok) {
            note({ tone: "error", text: result.message });
          } else if (result.outcome === "queued") {
            note({ tone: "info", text: "Queued" });
          } else {
            note({ tone: "info", text: movedText });
          }
        },
        onError: () =>
          note({ tone: "error", text: "Couldn't move the session." }),
        onSettled: () => setPendingSessionId(null),
      },
    );
  };

  const changePin = (session: AccountSessionEntry, pinned: boolean) => {
    const { sessionId } = session;
    const note = (next: SessionNote | null) =>
      setNotes((prev) => {
        const rest = Object.fromEntries(
          Object.entries(prev).filter(([id]) => id !== sessionId),
        );
        return next ? { ...rest, [sessionId]: next } : rest;
      });
    setPendingSessionId(sessionId);
    pinOnce(
      { cardId: session.cardId, sessionId, pinned },
      {
        onSuccess: (result) =>
          note(result.ok ? null : { tone: "error", text: result.error }),
        onError: () =>
          note({ tone: "error", text: "Couldn't change the pin." }),
        onSettled: () => setPendingSessionId(null),
      },
    );
  };

  return (
    <RunningSessionsList
      sessions={sessions}
      accounts={accounts}
      notes={notes}
      pendingSessionId={pendingSessionId}
      onPinChange={changePin}
      onRestart={(session) => run(session, session.accountId, "Restarted")}
      onContinue={(session) =>
        run(session, activeId, `Moved to ${accountName(accounts, activeId)}`)
      }
    />
  );
}
