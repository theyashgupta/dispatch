import type {
  AccountSessionEntry,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import { SessionAccountLabel } from "@/components/badges/SessionAccountLabel";
import { StaleBadge } from "@/components/badges/StaleBadge";
import { SessionContinueButton } from "@/components/SessionContinueButton";
import { SessionRestartButton } from "@/components/SessionRestartButton";
import { Item } from "@/components/ui/item";
import {
  accountName,
  pendingNote,
  turnLabel,
} from "@/modules/accounts/domain/running-sessions";

export interface SessionNote {
  tone: "error" | "info";
  text: string;
}

interface RunningSessionsListProps {
  sessions: AccountSessionEntry[];
  accounts: ClaudeAccountSummary[];
  notes: Record<string, SessionNote>;
  pendingSessionId: string | null;
  onRestart: (session: AccountSessionEntry) => void;
  onContinue: (session: AccountSessionEntry) => void;
}

export function RunningSessionsList({
  sessions,
  accounts,
  notes,
  pendingSessionId,
  onRestart,
  onContinue,
}: RunningSessionsListProps) {
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="running-sessions-heading"
      data-testid="running-sessions"
    >
      <h2
        id="running-sessions-heading"
        className="text-sm font-semibold text-foreground"
      >
        Running sessions
      </h2>
      {sessions.length === 0 && (
        <span className="text-xs text-muted-foreground">
          No running sessions.
        </span>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {sessions.map((session) => {
          const note = notes[session.sessionId];
          const busy = pendingSessionId !== null;
          return (
            <li key={session.sessionId}>
              <Item
                variant="outline"
                size="sm"
                className="bg-card p-2 text-foreground"
                data-session-id={session.sessionId}
                data-testid="session-row"
              >
                <div className="flex min-w-0 flex-auto basis-48 flex-col gap-1">
                  <span
                    className="truncate text-sm font-semibold"
                    title={`${session.cardId} ${session.cardTitle}`}
                  >
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {session.cardId}
                    </span>{" "}
                    {session.cardTitle}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <SessionAccountLabel
                      name={accountName(accounts, session.accountId)}
                    />
                    <span data-testid="session-turn">
                      {turnLabel(session.turn)}
                    </span>
                    {session.stale && <StaleBadge />}
                  </span>
                  {session.pendingAccountId !== undefined && (
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid="session-pending"
                    >
                      {pendingNote(
                        accountName(accounts, session.pendingAccountId),
                        session.pendingAccountId === session.accountId,
                      )}
                    </span>
                  )}
                  {note && (
                    <span
                      role={note.tone === "error" ? "alert" : "status"}
                      className={
                        note.tone === "error"
                          ? "text-xs text-destructive-text"
                          : "text-xs text-muted-foreground"
                      }
                      data-testid="session-note"
                    >
                      {note.text}
                    </span>
                  )}
                </div>
                {(session.stale || session.continueAction !== undefined) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {session.stale && (
                      <SessionRestartButton
                        pending={pendingSessionId === session.sessionId}
                        disabled={busy}
                        onRestart={() => onRestart(session)}
                      />
                    )}
                    {session.continueAction !== undefined && (
                      <SessionContinueButton
                        action={session.continueAction}
                        pending={pendingSessionId === session.sessionId}
                        disabled={busy}
                        onContinue={() => onContinue(session)}
                      />
                    )}
                  </div>
                )}
              </Item>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
