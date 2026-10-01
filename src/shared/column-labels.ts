import type { Column } from "./types.js";

export const COLUMN_LABELS: Record<Column, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  needs_input: "Needs Input",
  agent_done: "Agent Done",
  in_review: "In Review",
  parked: "Parked",
  done: "Done",
  inbox: "Inbox",
};
