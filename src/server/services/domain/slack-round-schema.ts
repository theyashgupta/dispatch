import { z } from "zod";
import {
  SLACK_CHANNEL_NAME,
  type SlackChannel,
} from "../../../shared/types.js";

const TS = /^\d{1,11}(\.\d{1,6})?$/;
const AUTHOR_MAX = 80;
const ORIGIN_IN_TEXT = /https:\/\/([a-z0-9-]+)\.slack\.com\/archives\//;
const JOIN_LEAVE = /^<@U[A-Z0-9]+(\|[^>]*)?> has (joined|left) the channel\.?$/;
const ROUND_DATA_TOOLS = [
  "slack_read_channel",
  "slack_search_public_and_private",
  "slack_read_thread",
];
const SEARCH_TOOL = "slack_search_public_and_private";
const THREAD_DATA_TOOLS = ["slack_read_thread"];
const CHANNELS_DATA_TOOLS = ["slack_list_user_channels"];
const THREAD_MAX = 40;
const ERROR_TEXT_MAX = 200;
const CHANNELS_MAX = 200;
const FENCE = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;

const blankAsAbsent = (value: unknown): unknown =>
  value === "" || value === null ? undefined : value;

const authorSchema = z.preprocess(
  (value) =>
    value === undefined || value === null || value === ""
      ? "Unknown"
      : typeof value === "string"
        ? value.slice(0, AUTHOR_MAX)
        : value,
  z.string(),
);

const roundBodySchema = z.object({ messages: z.array(z.unknown()) });

export const slackMessageSchema = z.object({
  conversationId: z.string().regex(/^[CDG][A-Z0-9]{2,}$/),
  ts: z.string().regex(TS),
  author: authorSchema,
  text: z.string(),
  permalink: z.preprocess(blankAsAbsent, z.string().optional()),
  isMention: z.boolean(),
  threadTs: z.preprocess(blankAsAbsent, z.string().regex(TS).optional()),
});

export type SlackRoundMessage = z.infer<typeof slackMessageSchema>;

export interface SlackRoundRecord {
  message: { ts: string; text: string; thread_ts?: string };
  type: "dm" | "mention";
  channelId: string;
  channelName: string;
  conversation: "im" | "channel";
  author: string;
}

export type ParsedRound =
  | {
      ok: true;
      messages: SlackRoundMessage[];
      invalid: number;
      evidence: SlackEvidence[];
      denials: number;
      toolErrors: number;
      firstToolError?: string;
      origin?: string;
      costUsd?: number;
      durationMs?: number;
    }
  | { ok: false; reason: "no-slack-tool" | "invalid" };

class NoSlackToolError extends Error {}

const initSchema = z.object({
  tools: z.array(z.string()),
});

const assistantSchema = z.object({
  message: z.object({
    content: z.array(
      z.object({
        type: z.string(),
        id: z.string().optional(),
        name: z.string().optional(),
        input: z.unknown().optional(),
      }),
    ),
  }),
});

const userSchema = z.object({
  message: z.object({
    content: z.union([
      z.string(),
      z.array(
        z.object({
          type: z.string(),
          tool_use_id: z.string().optional(),
          content: z.unknown().optional(),
          is_error: z.boolean().optional(),
        }),
      ),
    ]),
  }),
});

const envelopeSchema = z.object({
  is_error: z.boolean().optional(),
  result: z.string(),
  permission_denials: z.array(z.unknown()).optional(),
  total_cost_usd: z.unknown().optional(),
  duration_ms: z.unknown().optional(),
});

export interface SlackEvidence {
  input: string;
  text: string;
}

/**
 * The user names that the round's tool results carry in `<@U...|Name>` mention labels.
 *
 * @remarks The model often drops the label from the text it returns, so the names come from the reads.
 */
export function mentionNames(
  evidence: readonly SlackEvidence[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const e of evidence) {
    for (const m of e.text.matchAll(/<@(U[A-Z0-9]+)\|([^>\n]{1,80})>/g)) {
      if (!names.has(m[1])) names.set(m[1], m[2]);
    }
  }
  return names;
}

/**
 * Whether `value` stands in `text` as a whole token, so a ts without its fraction does not match the full ts.
 */
function hasToken(text: string, value: string): boolean {
  for (let i = text.indexOf(value); i !== -1; i = text.indexOf(value, i + 1)) {
    const before = text[i - 1] ?? " ";
    const after = text.slice(i + value.length, i + value.length + 2);
    if (!/[A-Za-z0-9.]/.test(before) && !/^(?:[A-Za-z0-9]|\.\d)/.test(after)) {
      return true;
    }
  }
  return false;
}

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toolPart = (name: string): string =>
  name.slice(name.lastIndexOf("__") + 2);

const resultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("\n");
};

/**
 * Read the CLI stream-json lines and return the final result text as parsed JSON, with the call's cost,
 * duration, evidence, workspace origin from a search permalink, permission denial count and tool error
 * count.
 *
 * @remarks Evidence is each non-error tool result text after its call input, because a thread result names
 * no channel. The call counts only when the init event lists an allowed tool, the model used one and a data
 * tool returned a non-error result, else it throws `NoSlackToolError`, because a call that lost its reads can
 * answer a valid empty result. Denials and error results are counted, not fatal, so one bad channel does not
 * fail the other reads.
 */
function unwrapResult(
  stdout: string,
  allowedTools: readonly string[],
  dataTools: readonly string[],
): {
  body: unknown;
  evidence: SlackEvidence[];
  denials: number;
  toolErrors: number;
  firstToolError?: string;
  origin?: string;
  costUsd?: number;
  durationMs?: number;
} {
  const allowed = new Set(allowedTools);
  const used = new Map<string, { name: string; input: string }>();
  const results: {
    name: string;
    error: boolean;
    text: string;
    input: string;
  }[] = [];
  let init: z.infer<typeof initSchema> | undefined;
  let result: unknown;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const event = z
      .object({ type: z.string(), subtype: z.string().optional() })
      .passthrough()
      .parse(JSON.parse(line));
    if (event.type === "system" && event.subtype === "init") {
      init = initSchema.parse(event);
    } else if (event.type === "assistant") {
      for (const item of assistantSchema.parse(event).message.content) {
        if (
          item.type === "tool_use" &&
          item.name !== undefined &&
          allowed.has(item.name)
        ) {
          used.set(item.id ?? "", {
            name: item.name,
            input: JSON.stringify(item.input ?? {}),
          });
        }
      }
    } else if (event.type === "user") {
      const { content } = userSchema.parse(event).message;
      for (const item of typeof content === "string" ? [] : content) {
        const call = used.get(item.tool_use_id ?? "");
        if (item.type === "tool_result" && call !== undefined) {
          results.push({
            name: call.name,
            error: item.is_error === true,
            text: resultText(item.content),
            input: call.input,
          });
        }
      }
    } else if (event.type === "result") {
      result = event;
    }
  }
  if (init === undefined) throw new Error("no init event");
  if (!init.tools.some((tool) => allowed.has(tool)) || used.size === 0) {
    throw new NoSlackToolError("no Slack tool");
  }
  const envelope = envelopeSchema.parse(result);
  if (envelope.is_error === true) throw new Error("model error");
  const good = results.filter((r) => !r.error);
  if (!good.some((r) => dataTools.includes(toolPart(r.name)))) {
    throw new NoSlackToolError("no Slack read");
  }
  const errors = results.filter((r) => r.error);
  const text = envelope.result.trim();
  const costUsd = finite(envelope.total_cost_usd);
  const durationMs = finite(envelope.duration_ms);
  const found = good
    .filter((r) => toolPart(r.name) === SEARCH_TOOL)
    .map((r) => ORIGIN_IN_TEXT.exec(r.text.replaceAll("\\/", "/")))
    .find((m) => m !== null);
  return {
    body: JSON.parse(FENCE.exec(text)?.[1] ?? text),
    evidence: good.map((r) => ({ input: r.input, text: r.text })),
    denials: (envelope.permission_denials ?? []).length,
    toolErrors: errors.length,
    ...(errors[0] !== undefined
      ? { firstToolError: errors[0].text.slice(0, ERROR_TEXT_MAX) }
      : {}),
    ...(found ? { origin: `https://${found[1]}.slack.com` } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

/**
 * Read the CLI stream-json output and validate its result text as the round shape.
 *
 * @remarks The body must be an object with a `messages` array, else the round is invalid. Each message is
 * checked alone, and an invalid one is dropped and counted.
 */
export function parseRoundOutput(
  stdout: string,
  allowedTools: readonly string[],
): ParsedRound {
  try {
    const { body, origin, costUsd, durationMs, ...reads } = unwrapResult(
      stdout,
      allowedTools,
      ROUND_DATA_TOOLS,
    );
    const round = roundBodySchema.safeParse(body);
    if (!round.success) return { ok: false, reason: "invalid" };
    const checked = round.data.messages.map((m) =>
      slackMessageSchema.safeParse(m),
    );
    return {
      ok: true,
      messages: checked.flatMap((c) => (c.success ? [c.data] : [])),
      invalid: checked.filter((c) => !c.success).length,
      ...reads,
      ...(origin !== undefined ? { origin } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof NoSlackToolError ? "no-slack-tool" : "invalid",
    };
  }
}

const threadSchema = z.object({
  messages: z.array(
    z.object({
      author: authorSchema,
      ts: z.string().regex(TS),
      text: z.string(),
    }),
  ),
  truncated: z.boolean().optional(),
});

const channelsSchema = z.object({
  channels: z.array(
    z.object({
      id: z.string().regex(/^[CG][A-Z0-9]{2,}$/),
      name: z.string().trim(),
      private: z.boolean().optional(),
    }),
  ),
});

/**
 * Read a thread call's stream-json output as at most 40 messages, or throw when the output is invalid.
 */
export function parseThreadOutput(
  stdout: string,
  allowedTools: readonly string[],
): {
  messages: { author: string; ts: string; text: string }[];
  truncated?: true;
} {
  const thread = threadSchema.parse(
    unwrapResult(stdout, allowedTools, THREAD_DATA_TOOLS).body,
  );
  const cut = thread.messages.length > THREAD_MAX;
  return {
    messages: thread.messages.slice(0, THREAD_MAX),
    ...(cut || thread.truncated === true ? { truncated: true } : {}),
  };
}

/**
 * Read a channel list call's stream-json output as at most 200 channels, or throw when the output is invalid.
 *
 * @remarks A channel with an invalid name is dropped, and the first channel of an id wins.
 */
export function parseChannelsOutput(
  stdout: string,
  allowedTools: readonly string[],
): {
  channels: { id: string; name: string; private: boolean }[];
  truncated: boolean;
} {
  const { channels } = channelsSchema.parse(
    unwrapResult(stdout, allowedTools, CHANNELS_DATA_TOOLS).body,
  );
  const seen = new Set<string>();
  const unique = channels.filter(
    (c) => SLACK_CHANNEL_NAME.test(c.name) && !seen.has(c.id) && seen.add(c.id),
  );
  return {
    channels: unique
      .slice(0, CHANNELS_MAX)
      .map((c) => ({ id: c.id, name: c.name, private: c.private === true })),
    truncated: unique.length > CHANNELS_MAX,
  };
}

/**
 * Keep the DMs and the mentions in picked channels, and shape each for `slackItem`.
 *
 * @remarks The model can read more than the user picked and can invent records, so the code, not the prompt,
 * enforces the picked channels, the round window and the evidence: a record needs its ts in one non-error tool
 * result and its conversation id in that result or its call input. A repeated conversation and ts pair keeps its first
 * record, and `unseen` counts the records dropped only for lack of evidence.
 */
export function selectRoundRecords(
  messages: readonly SlackRoundMessage[],
  picked: readonly SlackChannel[],
  round: { evidence: readonly SlackEvidence[]; since: Date; until: Date },
): { records: SlackRoundRecord[]; unseen: number } {
  const names = new Map(picked.map((c) => [c.id, c.name]));
  const seen = new Set<string>();
  const records: SlackRoundRecord[] = [];
  let unseen = 0;
  for (const m of messages) {
    const isDm = m.conversationId.startsWith("D");
    const channelName = names.get(m.conversationId);
    if (!isDm && !(channelName !== undefined && m.isMention)) continue;
    const key = `${m.conversationId}:${m.ts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (JOIN_LEAVE.test(m.text.trim())) continue;
    const at = Number(m.ts) * 1000;
    if (at < round.since.getTime() || at > round.until.getTime()) continue;
    if (
      !round.evidence.some(
        (e) =>
          hasToken(e.text, m.ts) &&
          (hasToken(e.text, m.conversationId) ||
            hasToken(e.input, m.conversationId)),
      )
    ) {
      unseen += 1;
      continue;
    }
    records.push({
      message: {
        ts: m.ts,
        text: m.text,
        ...(m.threadTs !== undefined ? { thread_ts: m.threadTs } : {}),
      },
      type: isDm ? "dm" : "mention",
      channelId: m.conversationId,
      channelName: isDm ? "" : (channelName ?? ""),
      conversation: isDm ? "im" : "channel",
      author: m.author,
    });
  }
  return { records, unseen };
}
