import type { SlackChannel } from "../../../shared/types.js";

export const CHANNEL_ID = /^[CG][A-Z0-9]{2,}$/;

/**
 * Turn a pasted channel link or bare channel id into the channel id, or null.
 *
 * @remarks Accepts a workspace archive link (with or without a message part), an app.slack.com
 * client link, or a bare C or G id. The host is not checked because the id is all that is used, and
 * a DM id (D) is refused because DMs are never picked.
 */
export function parseChannelRef(input: string): string | null {
  const value = input.trim();
  if (CHANNEL_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const archive = parts.indexOf("archives");
  const client = parts.indexOf("client");
  const id =
    archive >= 0
      ? parts[archive + 1]
      : client >= 0
        ? parts[client + 2]
        : undefined;
  return id !== undefined && CHANNEL_ID.test(id) ? id : null;
}

export const SLACK_CHANNEL_MAX = 200;

const NAME_MAX = 80;

/** True for a picked channel entry: a channel id and a non-empty name of at most 80 characters. */
export function isSlackChannel(value: unknown): value is SlackChannel {
  if (typeof value !== "object" || value === null) return false;
  const { id, name } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    CHANNEL_ID.test(id) &&
    typeof name === "string" &&
    name.trim() !== "" &&
    name.length <= NAME_MAX
  );
}

/** Trim each picked channel's name and keep the first entry per channel id. */
export function normalizeSlackChannels(
  channels: SlackChannel[],
): SlackChannel[] {
  const seen = new Set<string>();
  return channels
    .filter(({ id }) => !seen.has(id) && Boolean(seen.add(id)))
    .map(({ id, name }) => ({ id, name: name.trim() }));
}
