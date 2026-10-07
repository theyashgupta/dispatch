import type { Column as ColumnId } from "./types.js";

export const SINGLE_LINE_COPY: Record<Exclude<ColumnId, "todo">, string> = {
  in_progress: "Nothing running.",
  needs_input: "Nothing waiting on your input.",
  agent_done: "No finished agents yet.",
  in_review: "Nothing waiting on you.",
  parked: "Nothing set aside.",
  done: "Finished tickets land here.",
  inbox: "Nothing in the inbox.",
};
