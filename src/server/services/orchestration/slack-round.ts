import { run } from "../../adapters/exec.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";
import { startEnabledPollers } from "../../adapters/poller.js";
import {
  rebuildSources,
  renderSlackText,
  slackItem,
} from "../../adapters/source-gateway.js";
import { boardRepository as store } from "../../store/board-repository.js";
import type {
  SlackChannel,
  SlackChannelOption,
  SlackMcpStatus,
  SlackMode,
  SlackRoundError,
  SlackThread,
} from "../../../shared/types.js";
import { nextRunDelay, roundSince } from "./granola-actions.js";
import {
  mcpToolPrefix,
  pickConnector,
  readMcpList,
  type ConnectorCheck,
} from "./connector-list.js";
import { getOrchestrationConfig, slackMode } from "../infra/config-holder.js";
import { DISPATCH_DIR } from "../infra/paths.js";
import {
  parseChannelsOutput,
  parseRoundOutput,
  parseThreadOutput,
  mentionNames,
  selectRoundRecords,
} from "../domain/slack-round-schema.js";

const CURSOR_KEY = "mcp";
const ORIGIN = /^https:\/\/[a-z0-9-]+\.slack\.com$/;
const SLACK_SERVER = /slack/i;
const ROUND_TIMEOUT_MS = 300_000;
const KILL_GRACE_MS = 5_000;
const FIRST_ROUND_HOURS = 24;
const DEFAULT_INTERVAL_MINUTES = 30;
const CALL_TIMEOUT_MS = 90_000;
const CONNECTOR_MAX_AGE_MS = 60_000;
const CHANNELS_TTL_MS = 600_000;
const MCP_WAIT_ENV = {
  CLAUDE_CODE_MCP_STARTUP_WAIT_MS: "60000",
  MCP_TIMEOUT: "60000",
};
const FORBID_LINE =
  "Read only with the Slack tools. Never send, post, reply, react, edit, delete, schedule, draft or upload anything in Slack.";

export type SlackRunResult =
  "started" | "running" | "disabled" | "not-connected";

type SlackConnectorRead =
  ConnectorCheck | { state: "claude-missing" | "failed" };

export const SLACK_READ_TOOLS: readonly string[] = [
  "mcp__claude_ai_Slack__slack_read_user_profile",
  "mcp__claude_ai_Slack__slack_list_user_channels",
  "mcp__claude_ai_Slack__slack_read_channel",
  "mcp__claude_ai_Slack__slack_search_public_and_private",
  "mcp__claude_ai_Slack__slack_read_thread",
];

export const SLACK_HIDDEN_TOOLS: readonly string[] = [
  "mcp__claude_ai_Slack__slack_get_reactions",
  "mcp__claude_ai_Slack__slack_list_channel_members",
  "mcp__claude_ai_Slack__slack_read_canvas",
  "mcp__claude_ai_Slack__slack_read_file",
  "mcp__claude_ai_Slack__slack_read_list",
  "mcp__claude_ai_Slack__slack_search_channels",
  "mcp__claude_ai_Slack__slack_search_emojis",
  "mcp__claude_ai_Slack__slack_search_public",
  "mcp__claude_ai_Slack__slack_search_users",
  "mcp__claude_ai_Slack__slack_send_message",
  "mcp__claude_ai_Slack__slack_send_message_draft",
  "mcp__claude_ai_Slack__slack_schedule_message",
  "mcp__claude_ai_Slack__slack_add_reaction",
  "mcp__claude_ai_Slack__slack_create_canvas",
  "mcp__claude_ai_Slack__slack_update_canvas",
  "mcp__claude_ai_Slack__slack_create_conversation",
  "mcp__claude_ai_Slack__slack_add_list_record",
  "mcp__claude_ai_Slack__slack_create_list",
  "mcp__claude_ai_Slack__slack_update_list",
  "mcp__claude_ai_Slack__slack_update_list_record",
  "mcp__claude_ai_Slack__slack_get_file_upload_url",
  "mcp__claude_ai_Slack__slack_complete_file_upload",
];

const THREAD_TOOL = "mcp__claude_ai_Slack__slack_read_thread";
const CHANNELS_TOOL = "mcp__claude_ai_Slack__slack_list_user_channels";

let current: Promise<void> | null = null;
let controller: AbortController | null = null;
let timer: NodeJS.Timeout | null = null;
let epoch = 0;
let claiming = false;
let applying: Promise<void> = Promise.resolve();
let last: {
  lastRunAt?: string;
  lastError?: SlackRoundError;
  lastCount?: number;
} = {};
let connectorCache: { at: number; read: SlackConnectorRead } | null = null;
let connectorFlight: Promise<SlackConnectorRead> | null = null;
let channelsCache: { at: number; value: ChannelList } | null = null;
let channelsFlight: Promise<ChannelList> | null = null;
const threadFlights = new Map<string, Promise<SlackThread>>();

interface ChannelList {
  channels: SlackChannelOption[];
  truncated: boolean;
}

/**
 * The read tool names with the prefix of the chosen server in place of the recorded one.
 *
 * @remarks A plugin Slack server can be the only connected one, and its tools carry another prefix.
 */
export function slackAllowedTools(server: string): string[] {
  return SLACK_READ_TOOLS.map((name) => serverTool(server, name));
}

/**
 * Every Slack tool of the chosen server that the call does not allow, for `--disallowedTools`.
 *
 * @remarks A removed tool is never offered, so the model cannot call it and meet a permission denial. The
 * default is the round call, which allows every read tool and hides the rest.
 */
export function slackBlockedTools(
  server: string,
  allowed: readonly string[] = slackAllowedTools(server),
): string[] {
  return [...SLACK_READ_TOOLS, ...SLACK_HIDDEN_TOOLS]
    .map((name) => serverTool(server, name))
    .filter((name) => !allowed.includes(name));
}

function serverTool(server: string, name: string): string {
  return `${mcpToolPrefix(server)}__${name.slice(name.lastIndexOf("__") + 2)}`;
}

/**
 * The prompt of one round: the window, the sources to read and the JSON contract.
 */
export function buildSlackRoundPrompt(
  since: Date,
  until: Date,
  picked: readonly SlackChannel[],
  knowsOrigin: boolean,
): string {
  const channels =
    picked.length > 0
      ? picked.map((c) => `- ${c.id} #${c.name}`)
      : ["- no channels"];
  return [
    "You are collecting the user's new Slack messages for Dispatch, a local task board.",
    FORBID_LINE,
    "",
    `Window: from ${since.toISOString()} to ${until.toISOString()} (Slack seconds ${Math.floor(since.getTime() / 1000)} to ${Math.floor(until.getTime() / 1000)}).`,
    "Read the history of these sources inside the window, and nothing else:",
    "- the user's direct messages, including the self DM",
    "- the history of these channels only:",
    ...channels.map((line) => `  ${line}`),
    "",
    "Rules:",
    "- Find the user's own id first, then read the sources above.",
    "- Set isMention to true when the message text mentions the user's id with <@ID>, else false.",
    "- Include messages other people sent to the user and the user's own notes in the self DM.",
    "- Skip messages the user sent to other people.",
    ...(knowsOrigin
      ? []
      : [
          "- Also call slack_search_public_and_private once for one recent message in the sources above, so its permalink is known.",
        ]),
    "",
    'Output exactly one JSON object and nothing else, with no preamble and no code fence: {"messages":[{"conversationId":"<C, D or G id>","ts":"<Slack ts>","author":"<display name>","text":"<message text>","permalink":"<https permalink of the message>","isMention":true,"threadTs":"<thread ts, set for a thread reply, and for a message that has replies (its own ts)>"}]}',
    'When nothing matches, output exactly: {"messages":[]}',
    'Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.',
  ].join("\n");
}

/**
 * Run one restricted `claude -p` call with only the given tools allowed and return its stdout.
 *
 * @remarks The restricted flag keeps the user's settings files out of the call, and an empty tools
 * list drops every built-in tool, so the allowed list is the whole reach of the model. The deny list
 * hides every other Slack tool, and the `dontAsk` mode refuses a write tool even when a prompt injection
 * asks for one.
 */
export async function runSlackCall(input: {
  tools: readonly string[];
  blocked: readonly string[];
  prompt: string;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<string> {
  const claude = await resolveBinaryPath("claude");
  if (claude === null) throw new Error("claude-missing");
  const { stdout } = await run(
    claude,
    [
      "-p",
      "--restricted",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "sonnet",
      "--tools",
      "",
      "--allowedTools",
      input.tools.join(","),
      "--disallowedTools",
      input.blocked.join(","),
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--no-session-persistence",
    ],
    {
      cwd: DISPATCH_DIR,
      timeout: input.timeoutMs + KILL_GRACE_MS,
      maxBuffer: 10 * 1024 * 1024,
      signal: input.signal,
      killEscalationMs: KILL_GRACE_MS,
      input: input.prompt,
      env: MCP_WAIT_ENV,
    },
  );
  return stdout;
}

function slackIntervalMs(): number {
  const minutes = getOrchestrationConfig()?.sources?.slack?.mcpIntervalMinutes;
  const valid =
    typeof minutes === "number" &&
    Number.isInteger(minutes) &&
    minutes >= 5 &&
    minutes <= 1440;
  return (valid ? minutes : DEFAULT_INTERVAL_MINUTES) * 60_000;
}

function polledAt(): string | undefined {
  return store.getSourceCursors("slack")[CURSOR_KEY]?.polledAt;
}

/**
 * Whether the Slack source switch is on in the held config.
 */
export function slackEnabled(): boolean {
  return getOrchestrationConfig()?.sources?.slack?.enabled === true;
}

/**
 * The Slack mode and switch as they stand now, for `applySlackSettings` to compare against.
 */
export async function slackSettings(): Promise<{
  mode: SlackMode;
  enabled: boolean;
}> {
  return { mode: await slackMode(), enabled: slackEnabled() };
}

async function roundsOn(): Promise<boolean> {
  return slackEnabled() && (await slackMode()) === "mcp";
}

async function readConnector(
  signal?: AbortSignal,
): Promise<SlackConnectorRead> {
  const claude = await resolveBinaryPath("claude");
  const read: SlackConnectorRead =
    claude === null
      ? { state: "claude-missing" }
      : pickConnector(await readMcpList(claude, signal), SLACK_SERVER);
  connectorCache = { at: Date.now(), read };
  return read;
}

/**
 * The Slack connector state from the last read when it is under a minute old, else one fresh read.
 *
 * @remarks Callers that arrive during a read share it, so a burst of requests spawns one `claude mcp list`.
 * A failed read answers `failed` and is not remembered.
 */
export async function slackConnector(): Promise<SlackConnectorRead> {
  if (
    connectorCache !== null &&
    Date.now() - connectorCache.at < CONNECTOR_MAX_AGE_MS
  ) {
    return connectorCache.read;
  }
  connectorFlight ??= readConnector()
    .catch((): SlackConnectorRead => ({ state: "failed" }))
    .finally(() => {
      connectorFlight = null;
    });
  return connectorFlight;
}

/**
 * The status the Slack connector route answers; it never carries model output or stderr.
 */
export async function slackMcpStatus(): Promise<SlackMcpStatus> {
  const mode = await slackMode();
  const at = polledAt();
  const connector = mode === "mcp" ? await slackConnector() : null;
  return {
    mode,
    enabled: slackEnabled(),
    running: current !== null,
    ...last,
    ...(connector !== null
      ? {
          connector: connector.state,
          ...("server" in connector ? { server: connector.server } : {}),
        }
      : {}),
    ...(at !== undefined ? { polledAt: at } : {}),
  };
}

/**
 * One Slack round: gate on `claude mcp list`, ask Claude with only the read tools allowed, then
 * upsert the items and advance the cursor.
 *
 * @remarks The round owns its 300 s limit as an abort with reason "timeout", because the exec
 * wrapper does not report which of a timeout or an abort ended the child. The cursor moves only
 * after a valid output, so an invalid one is read again by the next round. `onCheck` reports once
 * whether the connector check passed.
 */
async function runRound(
  round: AbortController,
  onCheck: (connected: boolean) => void,
): Promise<void> {
  if (!(await roundsOn())) return;
  const signal = round.signal;
  const limit = setTimeout(() => round.abort("timeout"), ROUND_TIMEOUT_MS);
  const now = new Date();
  const finish = (fields: Partial<typeof last>): void => {
    last = {
      ...last,
      lastRunAt: new Date().toISOString(),
      lastCount: undefined,
      ...fields,
    };
  };
  try {
    const check = await readConnector(signal);
    onCheck(check.state === "connected");
    if (check.state !== "connected") {
      finish({ lastError: check.state });
      return;
    }
    const picked = getOrchestrationConfig()?.sources?.slack?.channels ?? [];
    const entry = store.getSourceCursors("slack")[CURSOR_KEY];
    const { since, until } = roundSince(entry, FIRST_ROUND_HOURS, now);
    const storedOrigin =
      entry?.origin !== undefined && ORIGIN.test(entry.origin)
        ? entry.origin
        : undefined;
    const tools = slackAllowedTools(check.server);
    const stdout = await runSlackCall({
      tools,
      blocked: slackBlockedTools(check.server, tools),
      prompt: buildSlackRoundPrompt(
        since,
        until,
        picked,
        storedOrigin !== undefined,
      ),
      signal,
      timeoutMs: ROUND_TIMEOUT_MS,
    });
    const parsed = parseRoundOutput(stdout, tools);
    if (!parsed.ok) {
      if (parsed.reason === "no-slack-tool") {
        console.warn("[slack] round had no Slack tool");
        finish({ lastError: "failed" });
        return;
      }
      finish({ lastError: "invalid-output" });
      return;
    }
    const origin = parsed.origin ?? storedOrigin;
    if (parsed.toolErrors > 0) {
      console.warn(
        `[slack] round tool errors: ${parsed.toolErrors}, first: ${parsed.firstToolError ?? ""}`,
      );
    }
    const { records, unseen } = selectRoundRecords(parsed.messages, picked, {
      evidence: parsed.evidence,
      since,
      until,
    });
    const names = mentionNames(parsed.evidence);
    const items = records.map((record) => {
      const item = slackItem({
        ...record,
        names,
        teamUrl: origin ?? "",
      });
      return origin === undefined
        ? {
            ...item,
            url: `https://slack.com/app_redirect?channel=${record.channelId}`,
          }
        : item;
    });
    const inserted =
      items.length > 0
        ? (await store.upsertItems("slack", items, { kind: "append" })).inserted
        : 0;
    await store.setSourceCursors("slack", {
      ...store.getSourceCursors("slack"),
      [CURSOR_KEY]: {
        cursor: until.toISOString(),
        polledAt: now.toISOString(),
        ...(origin !== undefined ? { origin } : {}),
      },
    });
    console.log(
      `[slack] round read ${items.length} items (${unseen} not found in a tool result, ${parsed.invalid} invalid, ${parsed.denials} permission denials) in ${parsed.durationMs ?? "unknown"} ms, cost ${parsed.costUsd ?? "unknown"} USD`,
    );
    finish({ lastError: undefined, lastCount: inserted });
  } catch {
    if (signal.reason === "settings") return;
    const code = signal.reason === "timeout" ? "timeout" : "failed";
    console.warn(`[slack] round ended with ${code}`);
    finish({ lastError: code });
  } finally {
    clearTimeout(limit);
  }
}

function clearTimer(): void {
  epoch += 1;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/**
 * Arm the timer for the next round, or leave it cleared when Slack is off or not in `mcp` mode.
 *
 * @remarks The mode read can wait on the Vault, so a stop that lands meanwhile cancels this arm
 * through `epoch`.
 */
async function arm(delayMs: number): Promise<void> {
  clearTimer();
  const stamp = epoch;
  if (!(await roundsOn()) || stamp !== epoch) return;
  timer = setTimeout(() => {
    timer = null;
    void runSlackRound();
  }, delayMs);
  timer.unref();
}

/**
 * Start a round and answer whether its connector check passed; the caller has checked no round runs.
 */
function startRound(): Promise<boolean> {
  const round = new AbortController();
  controller = round;
  let onCheck!: (connected: boolean) => void;
  const checked = new Promise<boolean>((resolve) => {
    onCheck = resolve;
  });
  current = runRound(round, onCheck).finally(() => {
    onCheck(false);
    current = null;
    controller = null;
    if (!round.signal.aborted || round.signal.reason === "timeout") {
      void arm(slackIntervalMs());
    }
  });
  return checked;
}

/**
 * Start a round unless one runs or a Run now claim is pending, and return the running round.
 *
 * @remarks The timer calls this, so a claim in progress wins and the timer starts nothing.
 */
export function runSlackRound(): Promise<void> {
  if (current === null && !claiming) void startRound();
  return current ?? Promise.resolve();
}

/**
 * Arm the timer for the next round, due at the interval after the last poll; it runs no round itself.
 */
export function startSlackRound(): Promise<void> {
  return arm(nextRunDelay(polledAt(), new Date(), slackIntervalMs()));
}

/**
 * Clear the timer and stop a running round, waiting until its child process has exited.
 */
export async function stopSlackRound(): Promise<void> {
  clearTimer();
  const running = current;
  controller?.abort("settings");
  await running;
}

/**
 * Run a round now and answer after its connector check.
 *
 * @remarks `running` is decided before any await, and `claiming` covers the mode read, so two calls
 * in one tick start one round. A failed check answers `not-connected` and the round ends with no model call.
 */
export async function runSlackNow(): Promise<SlackRunResult> {
  if (current !== null || claiming) return "running";
  claiming = true;
  try {
    if (!(await roundsOn())) return "disabled";
    if (current !== null) return "running";
    const checked = startRound();
    claiming = false;
    return (await checked) ? "started" : "not-connected";
  } finally {
    claiming = false;
  }
}

/**
 * React to a settings write that already reached the held config.
 *
 * @remarks Applies run one at a time in arrival order. Turning rounds off stops the timer and kills
 * a running round; turning them on arms the timer, or starts a round when the last success is older
 * than the interval. The source registry and the pollers always follow the new settings.
 */
export function applySlackSettings(previous: {
  mode: SlackMode;
  enabled: boolean;
}): Promise<void> {
  const next = applying.then(async () => {
    connectorCache = null;
    channelsCache = null;
    if (await roundsOn()) {
      const wasOn = previous.enabled && previous.mode === "mcp";
      if (!wasOn || (timer === null && current === null)) {
        const delay = nextRunDelay(polledAt(), new Date(), slackIntervalMs());
        if (delay === 0) void runSlackRound();
        else await arm(delay);
      }
    } else {
      await stopSlackRound();
    }
    const config = getOrchestrationConfig();
    if (config !== null) rebuildSources(config);
    startEnabledPollers();
  });
  applying = next.catch(() => {});
  return next;
}

function buildThreadPrompt(channel: string, threadTs: string): string {
  return [
    "You are reading one Slack thread for Dispatch, a local task board.",
    FORBID_LINE,
    "",
    `Read the thread in channel ${channel} whose parent message has ts ${threadTs}. Read the parent first, then the replies, oldest first, at most 40 messages.`,
    "",
    'Output exactly one JSON object and nothing else, with no preamble and no code fence: {"messages":[{"author":"<display name>","ts":"<Slack ts>","text":"<message text>"}],"truncated":false}',
    'Set truncated to true when the thread has more than 40 messages. Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.',
  ].join("\n");
}

function buildChannelsPrompt(): string {
  return [
    "You are listing the Slack channels of the user for Dispatch, a local task board.",
    FORBID_LINE,
    "",
    "List the public and private channels the user is a member of, with the channel list tool. Skip direct messages and group direct messages. At most 200 channels.",
    "",
    'Output exactly one JSON object and nothing else, with no preamble and no code fence: {"channels":[{"id":"<C or G id>","name":"<channel name without #>","private":false}]}',
    'When there are none, output exactly: {"channels":[]}. Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.',
  ].join("\n");
}

async function connectedServer(): Promise<string> {
  const read = await slackConnector();
  if (read.state !== "connected") throw new Error(read.state);
  return read.server;
}

/**
 * Read one thread through the connector with only the thread tool allowed.
 *
 * @remarks One call per channel and thread at a time, so a double click makes one call.
 */
export function readSlackThreadMcp(
  channel: string,
  threadTs: string,
): Promise<SlackThread> {
  const key = `${channel}:${threadTs}`;
  const flight =
    threadFlights.get(key) ??
    (async (): Promise<SlackThread> => {
      const server = await connectedServer();
      const tools = [serverTool(server, THREAD_TOOL)];
      const stdout = await runSlackCall({
        tools,
        blocked: slackBlockedTools(server, tools),
        prompt: buildThreadPrompt(channel, threadTs),
        timeoutMs: CALL_TIMEOUT_MS,
      });
      const out = parseThreadOutput(stdout, tools);
      return {
        messages: out.messages.map((m) => ({
          author: m.author,
          time: new Date(Number(m.ts) * 1000).toISOString(),
          text: renderSlackText(m.text, new Map()),
        })),
        truncated: out.truncated === true,
      };
    })().finally(() => {
      threadFlights.delete(key);
    });
  threadFlights.set(key, flight);
  return flight;
}

/**
 * List the user's channels through the connector with only the channel list tool allowed.
 *
 * @remarks The list is cached for 10 minutes and concurrent calls share one, because each call is a model
 * call on the user's plan.
 */
export async function listSlackChannelsMcp(): Promise<ChannelList> {
  if (
    channelsCache !== null &&
    Date.now() - channelsCache.at < CHANNELS_TTL_MS
  ) {
    return channelsCache.value;
  }
  channelsFlight ??= (async (): Promise<ChannelList> => {
    const server = await connectedServer();
    const tools = [serverTool(server, CHANNELS_TOOL)];
    const stdout = await runSlackCall({
      tools,
      blocked: slackBlockedTools(server, tools),
      prompt: buildChannelsPrompt(),
      timeoutMs: CALL_TIMEOUT_MS,
    });
    const value = parseChannelsOutput(stdout, tools);
    channelsCache = { at: Date.now(), value };
    return value;
  })().finally(() => {
    channelsFlight = null;
  });
  return channelsFlight;
}

/**
 * The name of a channel from the cached channel list, or undefined when the cache is empty or old.
 */
export function cachedSlackChannelName(id: string): string | undefined {
  if (channelsCache === null) return undefined;
  if (Date.now() - channelsCache.at >= CHANNELS_TTL_MS) return undefined;
  return channelsCache.value.channels.find((c) => c.id === id)?.name;
}
