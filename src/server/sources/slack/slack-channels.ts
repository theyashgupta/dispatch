import type { SlackChannelOption } from "../../../shared/types.js";
import { slackGet, text } from "./slack-api.js";

const PAGE_SIZE = 200;

const PAGE_MAX = 5;

export type SlackChannelList =
  | { ok: true; channels: SlackChannelOption[]; truncated: boolean }
  | { ok: false; code: string };

export type SlackChannelInfo =
  { ok: true; id: string; name: string } | { ok: false; code: string };

/**
 * List the public and private channels the token's user is in, sorted by name.
 *
 * @remarks At most 5 pages of 200 are read; `truncated` says more remained. A Slack refusal answers
 * its code instead of throwing, so the caller can tell a restricted list from an outage.
 */
export async function listSlackChannels(
  token: string,
): Promise<SlackChannelList> {
  const channels: SlackChannelOption[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_MAX; page += 1) {
    const body = await slackGet(token, "users.conversations", {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: PAGE_SIZE,
      cursor,
    });
    if (!body.ok) return { ok: false, code: text(body.error) };
    const rows = Array.isArray(body.channels) ? body.channels : [];
    for (const row of rows as Record<string, unknown>[]) {
      const id = text(row.id);
      if (id === "") continue;
      channels.push({
        id,
        name: text(row.name) || id,
        private: row.is_private === true,
      });
    }
    const meta = body.response_metadata as
      { next_cursor?: unknown } | undefined;
    cursor = text(meta?.next_cursor) || undefined;
    if (!cursor) {
      return { ok: true, channels: sortByName(channels), truncated: false };
    }
  }
  return { ok: true, channels: sortByName(channels), truncated: true };
}

/** Name one channel by id through conversations.info, or answer Slack's refusal code. */
export async function slackChannelInfo(
  token: string,
  id: string,
): Promise<SlackChannelInfo> {
  const body = await slackGet(token, "conversations.info", { channel: id });
  if (!body.ok) return { ok: false, code: text(body.error) };
  const channel = body.channel as { name?: unknown } | undefined;
  return { ok: true, id, name: text(channel?.name) || id };
}

function sortByName(channels: SlackChannelOption[]): SlackChannelOption[] {
  return [...channels].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}
