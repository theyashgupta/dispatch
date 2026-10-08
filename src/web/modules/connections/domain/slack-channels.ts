import type {
  SlackChannel,
  SlackChannelOption,
} from "../../../../shared/types.js";

export type SlackSetupFailure =
  | "not-a-channel"
  | "disabled"
  | "not-connected"
  | "rejected"
  | "restricted"
  | "unreachable";

export interface SlackChannelRow extends SlackChannelOption {
  notListed: boolean;
}

export const SLACK_PICK_MAX = 200;

const byName = (a: SlackChannel, b: SlackChannel) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Merge the channels Slack lists with the saved ones into one sorted picker list.
 *
 * @remarks A saved channel that Slack no longer lists (left, archived, or past the list cap) stays
 * in the list, flagged, so the user can still see and uncheck it.
 */
export function mergeChannelRows(
  listed: readonly SlackChannelOption[],
  saved: readonly SlackChannel[],
): SlackChannelRow[] {
  const rows = new Map<string, SlackChannelRow>();
  for (const channel of listed) {
    if (!rows.has(channel.id))
      rows.set(channel.id, { ...channel, notListed: false });
  }
  for (const channel of saved) {
    if (!rows.has(channel.id)) {
      rows.set(channel.id, { ...channel, private: false, notListed: true });
    }
  }
  return [...rows.values()].sort(byName);
}

/**
 * Add a resolved channel to the picker list as a listed row, keeping every existing row's flags.
 *
 * @remarks A pasted channel was just confirmed by Slack, so it is never flagged as not listed.
 */
export function addChannelRow(
  rows: readonly SlackChannelRow[],
  channel: SlackChannel,
): SlackChannelRow[] {
  if (rows.some((row) => row.id === channel.id)) return [...rows];
  return [
    ...rows,
    { id: channel.id, name: channel.name, private: false, notListed: false },
  ].sort(byName);
}

/** The rows whose name contains the filter text, ignoring case; an empty filter keeps every row. */
export function filterChannelRows(
  rows: readonly SlackChannelRow[],
  text: string,
): SlackChannelRow[] {
  const needle = text.trim().toLowerCase();
  return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

/** Add a channel to the picked list unless its id is already there. */
export function addPicked(
  picked: readonly SlackChannel[],
  channel: SlackChannel,
): SlackChannel[] {
  return picked.some((c) => c.id === channel.id)
    ? [...picked]
    : [...picked, { id: channel.id, name: channel.name }];
}

/** True when two picked lists hold the same channel ids, in any order. */
export function samePicked(
  a: readonly SlackChannel[],
  b: readonly SlackChannel[],
): boolean {
  const ids = new Set(a.map((c) => c.id));
  return a.length === b.length && b.every((c) => ids.has(c.id));
}

export const SLACK_SETUP_COPY: Record<SlackSetupFailure, string> = {
  "not-a-channel": "Slack could not find that channel. Check the link or ID.",
  disabled: "Turn on Poll Slack to add channels.",
  "not-connected": "Connect the Slack connector in claude.ai first.",
  rejected: "Slack refused the token. Reconnect Slack and try again.",
  restricted:
    "Listing channels is restricted. Paste a channel link or ID instead.",
  unreachable: "Couldn't reach Slack. Try again.",
};

/**
 * Decide whether the channel list request runs.
 *
 * @remarks
 * In `mcp` mode each list is one model call on the user's plan, so it waits for the Load channels
 * button. Token mode lists on mount.
 */
export function slackListEnabled(
  enabled: boolean,
  listOnDemand: boolean,
  requested: boolean,
): boolean {
  return enabled && (!listOnDemand || requested);
}
