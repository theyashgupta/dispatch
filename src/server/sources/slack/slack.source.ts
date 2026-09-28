import type {
  FilterCapabilities,
  FilterOption,
  Item,
  SlackChannel,
  SourceCredential,
  SourceCursor,
  SourceIssue,
} from "../../../shared/types.js";
import type { TicketSource } from "../ticket.source.js";
import { slackAuthTest, slackGet, text } from "./slack-api.js";
import { listConversations } from "./slack-channels.js";
import {
  classifyMessage,
  slackItem,
  type SlackMessage,
} from "./slack-message.js";
import {
  historyOldest,
  nextCursorState,
  orderTargets,
  type CursorMap,
  type SlackTarget,
} from "./slack-targets.js";

const HISTORY_LIMIT = 100;

const NAME_LOOKUP_MAX = 50;

const SKIPPED_CODES = new Set([
  "channel_not_found",
  "not_in_channel",
  "missing_scope",
]);

const TS_SHAPE = /^\d{1,11}(\.\d{1,6})?$/;

const PERMANENT_USER_CODES = new Set([
  "user_not_found",
  "user_not_visible",
  "missing_scope",
]);

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

/**
 * Keep a history row only when its ts is Slack-shaped and its other read fields have Slack's types.
 *
 * @remarks Any other row is dropped rather than trusted, because a malformed one would throw while
 * building its item and stall every later poll of that conversation.
 */
function isMessage(row: unknown): row is SlackMessage {
  if (typeof row !== "object" || row === null) return false;
  const { ts, text, user, thread_ts, reply_count } = row as Record<
    string,
    unknown
  >;
  return (
    typeof ts === "string" &&
    TS_SHAPE.test(ts) &&
    optionalString(text) &&
    optionalString(user) &&
    optionalString(thread_ts) &&
    (reply_count === undefined || typeof reply_count === "number")
  );
}

/**
 * List the user's direct and group DMs as poll targets.
 *
 * @remarks A DM with a deleted user is dropped because nobody can write there. A missing DM scope
 * answers null with one warning, so the picked channels are still read (U2-02 as changed);
 * any other refusal fails the poll.
 */
async function listDmTargets(token: string): Promise<SlackTarget[] | null> {
  const list = await listConversations(token, "im,mpim");
  if (!list.ok) {
    if (list.code === "missing_scope") {
      console.warn("[slack] DMs not read: the token lacks a DM scope");
      return null;
    }
    throw new Error(`Slack refused the DM list: ${list.code}`);
  }
  if (list.truncated) {
    console.warn("[slack] more DMs than the list cap; the rest are not read");
  }
  return list.rows
    .filter((row) => text(row.id) !== "" && row.is_user_deleted !== true)
    .map((row) => ({
      id: text(row.id),
      name: text(row.name),
      conversation: row.is_im === true ? ("im" as const) : ("mpim" as const),
    }));
}

/**
 * The Slack item source: mentions in the picked channels and messages in the user's DMs.
 *
 * @remarks An append source (R-04): items are only ever upserted, so a message that leaves the
 * read window keeps its item. Each poll reads at most 40 conversations and 50 author names, and
 * returns per-conversation cursors the poller stores after the items (R-11, R-12).
 */
export class SlackSource implements TicketSource {
  readonly id = "slack";
  readonly kind = "append" as const;
  readonly vaultKeys: readonly string[] = [
    "SLACK_USER_TOKEN",
    "SLACK_BOT_TOKEN",
  ];
  readonly capabilities: FilterCapabilities = { dimensions: [] };
  private readonly names = new Map<string, string>();

  constructor(
    private resolveCredential: () => Promise<SourceCredential | null>,
    private pickedChannels: () => readonly SlackChannel[],
    readonly pollIntervalMs: number,
    private now: () => number = Date.now,
  ) {}

  /**
   * A user's display name, from the cache or users.info while this poll's lookup budget lasts.
   *
   * @remarks A refusal that will not change on retry caches the id as the name, so an unknown
   * author does not spend the lookup budget on every poll.
   */
  private async nameOf(
    token: string,
    userId: string,
    budget: { left: number },
  ): Promise<string> {
    const known = this.names.get(userId);
    if (known !== undefined) return known;
    if (budget.left <= 0) return userId;
    budget.left -= 1;
    const body = await slackGet(token, "users.info", { user: userId });
    if (!body.ok) {
      if (PERMANENT_USER_CODES.has(text(body.error))) {
        this.names.set(userId, userId);
      }
      return userId;
    }
    const user = body.user as Record<string, unknown> | undefined;
    const profile = user?.profile as Record<string, unknown> | undefined;
    const name =
      text(profile?.display_name) ||
      text(profile?.real_name) ||
      text(user?.name) ||
      userId;
    this.names.set(userId, name);
    return name;
  }

  /**
   * Read one conversation's history window and turn its asks into items.
   *
   * @remarks A conversation Slack refuses to show is skipped for this poll only; its polledAt still
   * moves so it waits its turn. Any other refusal fails the whole poll.
   */
  private async readTarget(
    token: string,
    target: SlackTarget,
    prev: SourceCursor | undefined,
    poll: {
      me: string;
      teamUrl: string;
      polledAt: string;
      budget: { left: number };
    },
  ): Promise<{ items: Item[]; cursor: SourceCursor }> {
    const body = await slackGet(token, "conversations.history", {
      channel: target.id,
      oldest: historyOldest(prev?.cursor, this.now()),
      limit: HISTORY_LIMIT,
    });
    if (!body.ok) {
      const code = text(body.error);
      if (!SKIPPED_CODES.has(code)) {
        throw new Error(`Slack refused history for ${target.id}: ${code}`);
      }
      console.warn(`[slack] skipped ${target.id} this poll: ${code}`);
      return { items: [], cursor: nextCursorState(prev, [], poll.polledAt) };
    }
    if (body.has_more === true) {
      console.warn(
        `[slack] ${target.id} has more than ${HISTORY_LIMIT} new messages; older ones in this window are not read`,
      );
    }
    const messages = (Array.isArray(body.messages) ? body.messages : []).filter(
      isMessage,
    );
    const items: Item[] = [];
    for (const message of messages) {
      const type = classifyMessage(message, target.conversation, poll.me);
      if (!type || !message.user) continue;
      items.push(
        slackItem({
          message,
          type,
          channelId: target.id,
          channelName: target.name,
          conversation: target.conversation,
          author: await this.nameOf(token, message.user, poll.budget),
          names: this.names,
          teamUrl: poll.teamUrl,
        }),
      );
    }
    return {
      items,
      cursor: nextCursorState(prev, messages, poll.polledAt),
    };
  }

  /**
   * One poll: check the token, list the DMs, then read each ordered target once, oldest first.
   *
   * @remarks A 429 anywhere throws RateLimited so the whole poll is dropped and no cursor moves; a
   * conversation Slack refuses to show is skipped for this poll only. While the DM list is refused
   * every stored cursor is kept, so the DMs resume from their cursors once the scope returns. A
   * group DM also picked as a channel is read once, as the picked channel.
   */
  async fetch(opts?: { cursors?: Record<string, SourceCursor> }): Promise<{
    issues: SourceIssue[];
    items: Item[];
    truncated: boolean;
    cursors: Record<string, SourceCursor>;
  }> {
    const credential = await this.resolveCredential();
    if (!credential) throw new Error("no Slack credential is available");
    const token = credential.token;
    const auth = await slackAuthTest(token);
    if ("rejected" in auth) {
      throw new Error(`Slack refused auth.test: ${auth.rejected}`);
    }
    const channels: SlackTarget[] = this.pickedChannels().map((c) => ({
      id: c.id,
      name: c.name,
      conversation: "channel",
    }));
    const listed = await listDmTargets(token);
    const picked = new Set(channels.map((c) => c.id));
    const dms = (listed ?? []).filter((dm) => !picked.has(dm.id));
    const prev: CursorMap = opts?.cursors ?? {};
    const polledAt = new Date(this.now()).toISOString();
    const next: CursorMap = listed ? {} : { ...prev };
    for (const target of [...channels, ...dms]) {
      if (prev[target.id]) next[target.id] = prev[target.id];
    }
    const budget = { left: NAME_LOOKUP_MAX };
    await this.nameOf(token, auth.userId, budget);
    const poll = { me: auth.userId, teamUrl: auth.teamUrl, polledAt, budget };
    const items: Item[] = [];
    for (const target of orderTargets(channels, dms, prev)) {
      const read = await this.readTarget(token, target, prev[target.id], poll);
      items.push(...read.items);
      next[target.id] = read.cursor;
    }
    return { issues: [], items, truncated: false, cursors: next };
  }

  /** Slack has no filter dimensions, so there are never options to list. */
  listOptions(): Promise<{ options: FilterOption[]; truncated: boolean }> {
    return Promise.resolve({ options: [], truncated: false });
  }

  /** Slack has no filters, so a match count is always empty. */
  countMatches(): Promise<{ count: number; more: boolean }> {
    return Promise.resolve({ count: 0, more: false });
  }
}
