import type { Column as ColumnId } from "../../../shared/types.js";

export const COLUMN_LABELS: Record<ColumnId, string> = {
  todo: "TO DO",
  in_progress: "IN PROGRESS",
  needs_input: "NEEDS INPUT",
  agent_done: "AGENT DONE",
  in_review: "IN REVIEW",
  done: "DONE",
  inbox: "INBOX",
};

export const COLUMN_ACCENT: Record<ColumnId, string> = {
  todo: "var(--col-todo)",
  in_progress: "var(--col-in-progress)",
  needs_input: "var(--col-needs-input)",
  agent_done: "var(--col-agent-done)",
  in_review: "var(--col-in-review)",
  done: "var(--col-done)",
  inbox: "var(--accent)",
};
