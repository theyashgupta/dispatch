import { isWebUrl } from "../../../../shared/web-url.js";
import type { SlackRow } from "./slack-rows.js";

export type SlackActionId =
  "draftReply" | "promote" | "snooze" | "done" | "copyLink";

const SLACK_ACTIONS: { id: SlackActionId; label: string }[] = [
  { id: "draftReply", label: "Draft reply" },
  { id: "promote", label: "Promote to ticket" },
  { id: "snooze", label: "Snooze" },
  { id: "done", label: "Done" },
  { id: "copyLink", label: "Copy link" },
];

/** Return the detail actions a row offers, in button order; Copy link needs a web url. */
export function slackActions(
  row: SlackRow,
): { id: SlackActionId; label: string }[] {
  return SLACK_ACTIONS.filter(
    (action) => action.id !== "copyLink" || isWebUrl(row.url),
  );
}
