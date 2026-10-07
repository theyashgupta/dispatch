import type { SessionNote } from "../../../shared/session-account-view.js";

export function SessionNoteText({ note }: { note: SessionNote }) {
  return (
    <span
      role={note.tone === "error" ? "alert" : "status"}
      className={
        note.tone === "error"
          ? "min-w-0 text-xs break-words text-destructive-text"
          : "min-w-0 text-xs break-words text-muted-foreground"
      }
      data-testid="session-note"
    >
      {note.text}
    </span>
  );
}
