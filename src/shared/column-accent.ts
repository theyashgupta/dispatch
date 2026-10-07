import type { Column as ColumnId } from "./types.js";
import { COLUMN_LABELS as TITLE_LABELS } from "./column-labels.js";

export const COLUMN_LABELS = Object.fromEntries(
  Object.entries(TITLE_LABELS).map(([column, label]) => [
    column,
    label.toUpperCase(),
  ]),
) as Record<ColumnId, string>;

export const COLUMN_ACCENT: Record<ColumnId, string> = {
  todo: "var(--col-todo)",
  in_progress: "var(--col-in-progress)",
  needs_input: "var(--col-needs-input)",
  agent_done: "var(--col-agent-done)",
  in_review: "var(--col-in-review)",
  parked: "var(--col-parked)",
  done: "var(--col-done)",
  inbox: "var(--accent)",
};
