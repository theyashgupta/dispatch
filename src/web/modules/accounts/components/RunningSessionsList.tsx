import type {
  AccountSessionEntry,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import {
  accountName,
  pendingNote,
  type SessionNote,
} from "../../../../shared/session-account-view.js";
import { SessionNoteText } from "@/components/badges/SessionNoteText";
import { SessionAccountLabel } from "@/components/badges/SessionAccountLabel";
import { StaleBadge } from "@/components/badges/StaleBadge";
import { SessionContinueButton } from "@/components/SessionContinueButton";
import { SessionRestartButton } from "@/components/SessionRestartButton";
import { Item } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { turnLabel } from "@/modules/accounts/domain/running-sessions";

interface RunningSessionsListProps {
  sessions: AccountSessionEntry[];
  accounts: ClaudeAccountSummary[];
  notes: Record<string, SessionNote>;
  pending: { key: string; kind: "restart" | "continue" | "pin" } | null;
  onRestart: (session: AccountSessionEntry) => void;
  onContinue: (session: AccountSessionEntry) => void;
  onPinChange: (session: AccountSessionEntry, pinned: boolean) => void;
}

export function RunningSessionsList({
  sessions,
  accounts,
  notes,
  pending,
  onRestart,
  onContinue,
  onPinChange,
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
          const busy = pending !== null;
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
                      className="min-w-0 text-xs break-words text-muted-foreground"
                      data-testid="session-pending"
                    >
                      {pendingNote(
                        accountName(accounts, session.pendingAccountId),
                        session.pendingAccountId === session.accountId,
                      )}
                    </span>
                  )}
                  {note && <SessionNoteText note={note} />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`pin-${session.sessionId}`}
                      checked={session.pinned}
                      disabled={busy}
                      onCheckedChange={(pinned) => onPinChange(session, pinned)}
                      data-testid="session-pin"
                    />
                    <Label
                      htmlFor={`pin-${session.sessionId}`}
                      className="text-xs text-muted-foreground"
                    >
                      Pin to account
                    </Label>
                  </div>
                  {session.stale && (
                    <SessionRestartButton
                      pending={
                        pending?.key === session.sessionId &&
                        pending.kind === "restart"
                      }
                      disabled={busy}
                      onRestart={() => onRestart(session)}
                    />
                  )}
                  {session.continueAction !== undefined && (
                    <SessionContinueButton
                      action={session.continueAction}
                      pending={
                        pending?.key === session.sessionId &&
                        pending.kind === "continue"
                      }
                      disabled={busy}
                      onContinue={() => onContinue(session)}
                    />
                  )}
                </div>
              </Item>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
