import type { SlackThread, SlackThreadMessage } from "../../../shared/types.js";
import { slackGet, slackUserName, text } from "./slack-api.js";
import { isMessage, renderSlackText } from "./slack-message.js";

const THREAD_LIMIT = 40;

const NAME_LOOKUP_MAX = 20;

const CACHE_TTL_MS = 600_000;

const CACHE_MAX = 200;

const MENTION = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g;

/**
 * Read one Slack thread through conversations.replies: the parent first, then replies oldest first.
 *
 * @remarks One page of at most 40 messages; `truncated` carries Slack's has_more. Bot messages stay
 * as context, and authors and mentioned users share 20 parallel lookups into the caller's name
 * cache, a failed one falling back to the user id. A refused thread answers its code, a 429 throws
 * RateLimited and any transport failure throws.
 */
export async function fetchSlackThread(
  token: string,
  channel: string,
  threadTs: string,
  names: Map<string, string>,
): Promise<({ ok: true } & SlackThread) | { ok: false; code: string }> {
  const body = await slackGet(token, "conversations.replies", {
    channel,
    ts: threadTs,
    limit: THREAD_LIMIT,
  });
  if (!body.ok) return { ok: false, code: text(body.error) };
  const rows = (Array.isArray(body.messages) ? body.messages : []).filter(
    isMessage,
  );
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.user) ids.add(row.user);
    for (const [, id] of (row.text ?? "").matchAll(MENTION)) ids.add(id);
  }
  const budget = { left: NAME_LOOKUP_MAX };
  await Promise.all(
    [...ids].map((id) =>
      slackUserName(token, id, names, budget).catch(() => id),
    ),
  );
  const messages: SlackThreadMessage[] = rows.map((row) => {
    const username = (row as { username?: unknown }).username;
    return {
      author: row.user
        ? (names.get(row.user) ?? row.user)
        : text(username) || text(row.bot_id) || "unknown",
      time: new Date(Number(row.ts) * 1000).toISOString(),
      text: renderSlackText(row.text ?? "", names),
    };
  });
  return { ok: true, messages, truncated: body.has_more === true };
}

/**
 * A 10 minute in-memory cache of loaded threads, at most 200 entries.
 *
 * @remarks Inserting past the cap evicts the oldest entry. Only loaded threads go in, so a Slack
 * error is always asked again.
 */
export class SlackThreadCache {
  private readonly entries = new Map<
    string,
    { at: number; value: SlackThread }
  >();

  /** Start empty on the given clock, injected so tests can age entries. */
  constructor(private readonly now: () => number = Date.now) {}

  /** The cached thread for a key, or undefined once it is 10 minutes old. */
  get(key: string): SlackThread | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= CACHE_TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Store a loaded thread as the newest entry, evicting the oldest past 200. */
  set(key: string, value: SlackThread): void {
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    if (this.entries.size > CACHE_MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}
