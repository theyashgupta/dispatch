import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, mock, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";
import { writeConnectorClaude } from "../../test-support/stub-claude.js";

const env = isolateEnv();
const stubDir = path.join(env.root, "stub");
fs.mkdirSync(stubDir);
process.env.CONNECTOR_STUB_DIR = stubDir;
writeConnectorClaude(env.binDir);

const { store } = await import("../../store/board.store.js");
const { setOrchestrationConfig, getOrchestrationConfig } =
  await import("../infra/config-holder.js");
const {
  SLACK_READ_TOOLS,
  SLACK_HIDDEN_TOOLS,
  buildSlackRoundPrompt,
  cachedSlackChannelName,
  listSlackChannelsMcp,
  readSlackThreadMcp,
  runSlackNow,
  runSlackRound,
  slackAllowedTools,
  slackBlockedTools,
  slackMcpStatus,
} = await import("./slack-round.js");
await store.load();

const PICKED = [{ id: "C0TESTAAA", name: "dispatch-test-a" }];
const CONNECTED = [
  "plugin:design:slack: https://mcp.slack.example/mcp (HTTP) - ! Needs authentication",
  "claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected",
  "",
].join("\n");
const NEEDS_AUTH =
  "claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication\n";
const NOT_FOUND = "playwright: npx -y @playwright/mcp@latest - ✔ Connected\n";
const WORKSPACE = "https://dispatch-test.slack.com";
const MODEL_ORIGIN = "https://model-host.slack.com/archives/";
const NOW_S = Math.floor(Date.now() / 1000);
const DM_TS = `${NOW_S - 300}.000100`;
const MENTION_TS = `${NOW_S - 200}.000200`;
const OTHER_TS = `${NOW_S - 100}.000300`;
const UNPICKED_TS = `${NOW_S - 90}.000400`;
const ALL_TS = [
  `D0TESTDM1 ${DM_TS}`,
  `C0TESTAAA ${MENTION_TS}`,
  `C0TESTAAA ${OTHER_TS}`,
  `C0TESTZZZ ${UNPICKED_TS}`,
].join(" ");

function searchText(workspace = "dispatch-test"): string {
  return `Permalink: [link](https:\\/\\/${workspace}.slack.com\\/archives\\/C0TESTAAA\\/p1) ${ALL_TS}`;
}

function record(
  conversationId: string,
  ts: string,
  isMention: boolean,
): Record<string, unknown> {
  return {
    conversationId,
    ts,
    author: "Test User",
    text: "hello",
    permalink: `${MODEL_ORIGIN}${conversationId}/p${ts.replace(".", "")}`,
    isMention,
  };
}

const VALID = JSON.stringify({
  type: "result",
  is_error: false,
  duration_ms: 18000,
  total_cost_usd: 0.106,
  result: JSON.stringify({
    messages: [
      record("D0TESTDM1", DM_TS, false),
      record("C0TESTAAA", MENTION_TS, true),
      record("C0TESTAAA", OTHER_TS, false),
      record("C0TESTZZZ", UNPICKED_TS, true),
      record("D0TESTDM1", DM_TS, false),
    ],
  }),
});
const INVALID = JSON.stringify({
  type: "result",
  is_error: false,
  result: JSON.stringify({ items: [] }),
});

function configure(mode: "mcp" | "token", enabled = true): void {
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { slack: { enabled, mode, channels: PICKED } },
  });
}

function stub(
  list: string,
  reply = VALID,
  mode = "reply",
  toolText = searchText(),
): void {
  for (const f of [
    "calls.log",
    "argv.log",
    "stdin.log",
    "claude.pid",
    "env.log",
    "tool-text.txt",
  ]) {
    fs.rmSync(path.join(stubDir, f), { force: true });
  }
  fs.writeFileSync(path.join(stubDir, "tool-text.txt"), toolText);
  fs.writeFileSync(path.join(stubDir, "mcp-list.txt"), list);
  fs.writeFileSync(path.join(stubDir, "reply.json"), reply);
  fs.writeFileSync(path.join(stubDir, "mode"), mode);
}

function log(name: string): string {
  try {
    return fs.readFileSync(path.join(stubDir, name), "utf8");
  } catch {
    return "";
  }
}

function firstCallFlag(flag: string): string | undefined {
  const lines = log("argv.log").split("\n@@")[0]?.split("\n") ?? [];
  const at = lines.indexOf(flag);
  return at === -1 ? undefined : lines[at + 1];
}

const modelCalls = (): number =>
  log("calls.log")
    .split("\n")
    .filter((l) => l === "call").length;

async function settled(): Promise<void> {
  while ((await slackMcpStatus()).running) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const slackItems = () => store.listItems().filter((i) => i.source === "slack");
const cursor = () => store.getSourceCursors("slack").mcp;

after(() => env.cleanup());

test("R1 a connected list and the valid round make the two items once, with the exact argv", async () => {
  configure("mcp");
  stub(CONNECTED);
  await runSlackRound();
  assert.deepEqual(
    slackItems()
      .map((i) => i.id)
      .sort(),
    [`slack:C0TESTAAA:${MENTION_TS}`, `slack:D0TESTDM1:${DM_TS}`],
  );
  const mention = store.getItem(`slack:C0TESTAAA:${MENTION_TS}`);
  assert.equal(
    mention?.url,
    `${WORKSPACE}/archives/C0TESTAAA/p${MENTION_TS.replace(".", "")}`,
  );
  assert.equal(
    store.getItem(`slack:D0TESTDM1:${DM_TS}`)?.url,
    `${WORKSPACE}/archives/D0TESTDM1/p${DM_TS.replace(".", "")}`,
  );
  assert.equal(cursor()?.origin, WORKSPACE);
  assert.equal(mention?.type, "mention");
  assert.equal(store.getItem(`slack:D0TESTDM1:${DM_TS}`)?.type, "dm");
  const status = await slackMcpStatus();
  assert.equal(status.lastCount, 2);
  assert.equal(status.lastError, undefined);
  assert.equal(status.connector, "connected");
  assert.equal(status.server, "claude.ai Slack");
  assert.equal(status.running, false);
  assert.ok(cursor());
  assert.equal(status.polledAt, cursor()?.polledAt);
  assert.deepEqual(log("argv.log").split("\n@@")[0]?.split("\n"), [
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
    SLACK_READ_TOOLS.join(","),
    "--disallowedTools",
    SLACK_HIDDEN_TOOLS.join(","),
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
  ]);
  const stdin = log("stdin.log");
  assert.ok(
    stdin.includes(
      "Never send, post, reply, react, edit, delete, schedule, draft or upload anything in Slack.",
    ),
  );
  assert.ok(stdin.includes("C0TESTAAA"));
  assert.ok(stdin.includes("Also call slack_search_public_and_private once"));
  assert.ok(stdin.includes('Never emit the literal text "DISPATCH_STATUS:"'));
  assert.equal(log("env.log"), "60000\n");
});

test("R1b the call hides every other Slack tool with --disallowedTools", async () => {
  stub(CONNECTED);
  await runSlackRound();
  assert.equal(
    firstCallFlag("--disallowedTools"),
    SLACK_HIDDEN_TOOLS.join(","),
  );
});

test("R1c the call runs in dontAsk mode", async () => {
  stub(CONNECTED);
  await runSlackRound();
  assert.equal(firstCallFlag("--permission-mode"), "dontAsk");
});

test("R2 the same round again adds nothing and keeps a read item read", async () => {
  const id = `slack:D0TESTDM1:${DM_TS}`;
  await store.setItemState(id, "read");
  const before = slackItems().length;
  stub(CONNECTED);
  await runSlackRound();
  assert.equal((await slackMcpStatus()).lastCount, 0);
  assert.equal(slackItems().length, before);
  assert.equal(store.getItem(id)?.state, "read");
});

test("R3 an invalid round adds nothing and keeps the cursor", async () => {
  const before = slackItems().length;
  const cursorBefore = JSON.stringify(cursor());
  stub(CONNECTED, INVALID);
  await runSlackRound();
  assert.equal(slackItems().length, before);
  assert.equal(JSON.stringify(cursor()), cursorBefore);
  const status = await slackMcpStatus();
  assert.equal(status.lastError, "invalid-output");
  assert.equal(status.lastCount, undefined);
});

test("R3b a CLI error envelope is an invalid output", async () => {
  stub(
    CONNECTED,
    JSON.stringify({
      type: "result",
      is_error: true,
      result: "Slack tools unavailable",
    }),
  );
  await runSlackRound();
  assert.equal((await slackMcpStatus()).lastError, "invalid-output");
});

test("R3c a failed call is a failed round and keeps the cursor", async () => {
  const cursorBefore = JSON.stringify(cursor());
  stub(CONNECTED, VALID, "fail");
  await runSlackRound();
  assert.equal((await slackMcpStatus()).lastError, "failed");
  assert.equal(JSON.stringify(cursor()), cursorBefore);
});

for (const fake of ["notools", "nouse", "toolerror", "profileonly"]) {
  test(`R3d a round in ${fake} mode ends failed, keeps the cursor and adds nothing`, async () => {
    const before = slackItems().length;
    const cursorBefore = JSON.stringify(cursor());
    stub(CONNECTED, VALID, fake);
    await runSlackRound();
    assert.equal(slackItems().length, before);
    assert.equal(JSON.stringify(cursor()), cursorBefore);
    const status = await slackMcpStatus();
    assert.equal(status.lastError, "failed");
    assert.equal(status.lastCount, undefined);
    assert.deepEqual(
      log("calls.log")
        .split("\n")
        .filter((l) => l === "call"),
      ["call"],
    );
  });
}

test("R3e a denied permission keeps the round green when a data read succeeded, and logs the count", async () => {
  const lines: string[] = [];
  const logged = mock.method(console, "log", (line: string) => {
    lines.push(line);
  });
  const fresh = `${NOW_S - 60}.000110`;
  stub(
    CONNECTED,
    reply([record("D0TESTDM1", fresh, false)]),
    "denied",
    `D0TESTDM1 ${fresh}`,
  );
  await runSlackRound();
  logged.mock.restore();
  assert.ok(store.getItem(`slack:D0TESTDM1:${fresh}`));
  const status = await slackMcpStatus();
  assert.equal(status.lastError, undefined);
  assert.equal(status.lastCount, 1);
  assert.ok(lines.some((l) => l.includes("1 permission denials")));
});

test("R3f one error result beside good reads keeps the good records and logs the error", async () => {
  const warns: string[] = [];
  const warned = mock.method(console, "warn", (line: string) => {
    warns.push(line);
  });
  const fresh = `${NOW_S - 61}.000120`;
  stub(
    CONNECTED,
    reply([record("D0TESTDM1", fresh, false)]),
    "mixed",
    `D0TESTDM1 ${fresh}`,
  );
  await runSlackRound();
  warned.mock.restore();
  assert.ok(store.getItem(`slack:D0TESTDM1:${fresh}`));
  assert.equal((await slackMcpStatus()).lastError, undefined);
  assert.deepEqual(warns, [
    "[slack] round tool errors: 1, first: channel_not_found",
  ]);
});

test("R3g one invalid record is dropped, the others are kept and the count is logged", async () => {
  const lines: string[] = [];
  const logged = mock.method(console, "log", (line: string) => {
    lines.push(line);
  });
  const good = `${NOW_S - 62}.000130`;
  const bad = `${NOW_S - 63}.000140`;
  stub(
    CONNECTED,
    reply([
      record("D0TESTDM1", good, false),
      { ...record("D0TESTDM1", bad, false), isMention: "yes" },
    ]),
    "reply",
    `D0TESTDM1 ${good} ${bad}`,
  );
  await runSlackRound();
  logged.mock.restore();
  assert.ok(store.getItem(`slack:D0TESTDM1:${good}`));
  assert.equal(store.getItem(`slack:D0TESTDM1:${bad}`), undefined);
  assert.equal((await slackMcpStatus()).lastError, undefined);
  assert.ok(lines.some((l) => l.includes("1 invalid")));
});

test("R4 a needs-auth list reads the list and makes no model call", async () => {
  stub(NEEDS_AUTH);
  await runSlackRound();
  assert.equal(log("calls.log"), "mcp list\n");
  const status = await slackMcpStatus();
  assert.equal(status.lastError, "needs-auth");
  assert.equal(status.connector, "needs-auth");
});

test("R5 a list with no Slack server reads the list and makes no model call", async () => {
  stub(NOT_FOUND);
  await runSlackRound();
  assert.equal(log("calls.log"), "mcp list\n");
  assert.equal((await slackMcpStatus()).lastError, "not-found");
});

const READ_WORDS = new Set(["read", "search", "get", "list", "fetch", "view"]);
const WRITE_WORDS = new Set([
  "send",
  "post",
  "reply",
  "react",
  "update",
  "edit",
  "delete",
  "create",
  "add",
  "schedule",
  "draft",
  "invite",
  "join",
  "set",
  "upload",
]);

function readOnly(name: string): boolean {
  const words = name.slice(name.lastIndexOf("__") + 2).split("_");
  return (
    words.some((w) => READ_WORDS.has(w)) &&
    !words.some((w) => WRITE_WORDS.has(w))
  );
}

test("R6 every allowed tool is a read tool and no write tool is allowed", () => {
  assert.ok(SLACK_READ_TOOLS.length > 0);
  for (const name of SLACK_READ_TOOLS) assert.ok(readOnly(name), name);
  const writes = [
    "send_message",
    "send_message_draft",
    "schedule_message",
    "add_reaction",
    "create_canvas",
    "update_canvas",
    "create_conversation",
    "add_list_record",
    "create_list",
    "update_list",
    "update_list_record",
    "get_file_upload_url",
    "complete_file_upload",
  ];
  for (const w of writes) {
    assert.equal(readOnly(`mcp__claude_ai_Slack__slack_${w}`), false, w);
    assert.equal(
      SLACK_READ_TOOLS.some((t) => t.endsWith(`__slack_${w}`)),
      false,
      w,
    );
  }
  assert.ok(readOnly("mcp__claude_ai_Slack__slack_read_thread"));
  assert.equal(readOnly("mcp__claude_ai_Slack__slack_replies_x"), false);
});

test("R6b the hidden list holds the 13 write tools and the 9 other read tools, and no allowed tool", () => {
  const parts = (names: readonly string[]) =>
    names.map((n) => n.slice(n.lastIndexOf("__") + 2));
  assert.equal(SLACK_HIDDEN_TOOLS.length, 22);
  assert.equal(new Set(SLACK_HIDDEN_TOOLS).size, 22);
  for (const name of SLACK_HIDDEN_TOOLS) {
    assert.equal(SLACK_READ_TOOLS.includes(name), false, name);
  }
  for (const extra of [
    "get_reactions",
    "list_channel_members",
    "read_canvas",
    "read_file",
    "read_list",
    "search_channels",
    "search_emojis",
    "search_public",
    "search_users",
  ]) {
    assert.ok(parts(SLACK_HIDDEN_TOOLS).includes(`slack_${extra}`), extra);
  }
  const swapped = slackBlockedTools("plugin:design:slack");
  assert.equal(swapped.length, 22);
  assert.ok(swapped.every((n) => n.startsWith("mcp__plugin_design_slack__")));
  assert.deepEqual(slackBlockedTools("claude.ai Slack"), [
    ...SLACK_HIDDEN_TOOLS,
  ]);
});

test("R6c a single allowed tool hides the other four read tools and all hidden tools", () => {
  const thread = "mcp__claude_ai_Slack__slack_read_thread";
  const blocked = slackBlockedTools("claude.ai Slack", [thread]);
  assert.equal(blocked.length, 26);
  assert.equal(blocked.includes(thread), false);
  assert.ok(blocked.includes("mcp__claude_ai_Slack__slack_list_user_channels"));
});

test("R7 a plugin server swaps the prefix and keeps the tool parts", () => {
  const swapped = slackAllowedTools("plugin:design:slack");
  const parts = (names: readonly string[]) =>
    names.map((n) => n.slice(n.lastIndexOf("__") + 2));
  assert.deepEqual(parts(swapped), parts(SLACK_READ_TOOLS));
  assert.ok(swapped.every((n) => n.startsWith("mcp__plugin_design_slack__")));
  assert.deepEqual(slackAllowedTools("claude.ai Slack"), [...SLACK_READ_TOOLS]);
});

test("R8 token mode and a disabled source make no list read and no model call", async () => {
  stub(CONNECTED);
  configure("token");
  await runSlackRound();
  configure("mcp", false);
  await runSlackRound();
  assert.equal(log("calls.log"), "");
  configure("mcp");
});

test("R9 the first round reads the last 24 hours", async () => {
  await store.setSourceCursors("slack", {});
  stub(CONNECTED);
  await runSlackRound();
  const match = /from (\S+) to (\S+) \(Slack seconds (\d+) to (\d+)\)/.exec(
    log("stdin.log"),
  );
  assert.ok(match);
  const since = Date.parse(match[1] ?? "");
  const until = Date.parse(match[2] ?? "");
  assert.ok(Math.abs(until - since - 24 * 3_600_000) < 120_000);
  assert.ok(Math.abs(Number(match[4]) * 1000 - Date.now()) < 120_000);
});

test("R10 a later round starts 30 minutes before the last poll and keeps other cursors", async () => {
  await store.setSourceCursors("slack", {
    ...store.getSourceCursors("slack"),
    token: { cursor: "keep", polledAt: "2026-01-01T00:00:00.000Z" },
  });
  stub(CONNECTED);
  await runSlackRound();
  assert.equal(store.getSourceCursors("slack").token?.cursor, "keep");
  assert.ok(cursor());
});

test("R11 a call while a round runs shares that round", async () => {
  stub(CONNECTED);
  const first = runSlackRound();
  const second = runSlackRound();
  assert.equal(first, second);
  assert.equal((await slackMcpStatus()).running, true);
  await first;
  assert.equal((await slackMcpStatus()).running, false);
});

test("R12 the prompt lists the picked channels or says there are none", () => {
  const since = new Date("2026-10-07T00:00:00.000Z");
  const until = new Date("2026-10-08T00:00:00.000Z");
  assert.ok(
    buildSlackRoundPrompt(since, until, PICKED, true).includes(
      "C0TESTAAA #dispatch-test-a",
    ),
  );
  assert.ok(
    buildSlackRoundPrompt(since, until, [], true).includes("no channels"),
  );
  const ask = "Also call slack_search_public_and_private once";
  assert.ok(buildSlackRoundPrompt(since, until, PICKED, false).includes(ask));
  assert.equal(
    buildSlackRoundPrompt(since, until, PICKED, true).includes(ask),
    false,
  );
  assert.ok(
    buildSlackRoundPrompt(since, until, PICKED, true).includes(
      "for a thread reply, and for a message that has replies (its own ts)",
    ),
  );
  assert.equal(getOrchestrationConfig()?.sources?.slack?.mode, "mcp");
});

function reply(messages: Record<string, unknown>[]): string {
  return JSON.stringify({
    type: "result",
    is_error: false,
    result: JSON.stringify({ messages }),
  });
}

test("R13 a later round reuses the stored origin and does not ask for a search", async () => {
  await store.setSourceCursors("slack", {});
  stub(CONNECTED);
  await runSlackRound();
  assert.equal(cursor()?.origin, WORKSPACE);
  const fresh = `${NOW_S - 50}.000500`;
  stub(
    CONNECTED,
    reply([record("D0TESTDM1", fresh, false)]),
    "reply",
    `no link here D0TESTDM1 ${fresh}`,
  );
  await runSlackRound();
  assert.equal(
    store.getItem(`slack:D0TESTDM1:${fresh}`)?.url,
    `${WORKSPACE}/archives/D0TESTDM1/p${fresh.replace(".", "")}`,
  );
  assert.equal(cursor()?.origin, WORKSPACE);
  assert.equal(
    log("stdin.log").includes("Also call slack_search_public_and_private"),
    false,
  );
});

test("R14 a search permalink of another workspace replaces the stored origin", async () => {
  const fresh = `${NOW_S - 40}.000600`;
  stub(
    CONNECTED,
    reply([record("D0TESTDM1", fresh, false)]),
    "reply",
    `${searchText("other-ws")} D0TESTDM1 ${fresh}`,
  );
  await runSlackRound();
  assert.equal(
    store.getItem(`slack:D0TESTDM1:${fresh}`)?.url,
    `https://other-ws.slack.com/archives/D0TESTDM1/p${fresh.replace(".", "")}`,
  );
  assert.equal(cursor()?.origin, "https://other-ws.slack.com");
});

test("R15 no known origin falls back to the app redirect and stores none", async () => {
  await store.setSourceCursors("slack", {});
  const fresh = `${NOW_S - 30}.000700`;
  stub(
    CONNECTED,
    reply([record("D0TESTDM1", fresh, false)]),
    "reply",
    `no link here D0TESTDM1 ${fresh}`,
  );
  await runSlackRound();
  assert.equal(
    store.getItem(`slack:D0TESTDM1:${fresh}`)?.url,
    "https://slack.com/app_redirect?channel=D0TESTDM1",
  );
  assert.equal(cursor()?.origin, undefined);
  assert.ok(
    log("stdin.log").includes("Also call slack_search_public_and_private"),
  );
});

test("R16 a record whose ts is in no tool result is dropped", async () => {
  const known = `${NOW_S - 20}.000800`;
  const invented = `${NOW_S - 19}.000900`;
  stub(
    CONNECTED,
    reply([
      record("D0TESTDM1", known, false),
      record("D0FAKEDM1", invented, false),
    ]),
    "reply",
    `${searchText()} D0TESTDM1 ${known}`,
  );
  await runSlackRound();
  assert.ok(store.getItem(`slack:D0TESTDM1:${known}`));
  assert.equal(store.getItem(`slack:D0FAKEDM1:${invented}`), undefined);
  assert.equal((await slackMcpStatus()).lastCount, 1);
});

test("R17 a record outside the round window is dropped", async () => {
  await store.setSourceCursors("slack", {});
  const old = `${NOW_S - 3 * 86_400}.000100`;
  const future = `${NOW_S + 3600}.000200`;
  const inside = `${NOW_S - 10}.000300`;
  stub(
    CONNECTED,
    reply([
      record("D0TESTDM1", old, false),
      record("D0TESTDM1", future, false),
      record("D0TESTDM1", inside, false),
    ]),
    "reply",
    `${searchText()} D0TESTDM1 ${old} ${future} ${inside}`,
  );
  await runSlackRound();
  assert.equal(store.getItem(`slack:D0TESTDM1:${old}`), undefined);
  assert.equal(store.getItem(`slack:D0TESTDM1:${future}`), undefined);
  assert.ok(store.getItem(`slack:D0TESTDM1:${inside}`));
});

test("R18 an empty threadTs, permalink and author do not fail the round", async () => {
  const fresh = `${NOW_S - 5}.000100`;
  stub(
    CONNECTED,
    reply([
      {
        ...record("D0TESTDM1", fresh, false),
        threadTs: "",
        permalink: "",
        author: "",
      },
    ]),
    "reply",
    `${searchText()} D0TESTDM1 ${fresh}`,
  );
  await runSlackRound();
  const status = await slackMcpStatus();
  assert.equal(status.lastError, undefined);
  const item = store.getItem(`slack:D0TESTDM1:${fresh}`);
  assert.equal(item?.meta.author, "Unknown");
  assert.equal(item?.meta.threadTs, undefined);
});

test("R19 a join line and a mention label render in the item", async () => {
  const joined = `${NOW_S - 4}.000100`;
  const labelled = `${NOW_S - 3}.000200`;
  stub(
    CONNECTED,
    reply([
      {
        ...record("C0TESTAAA", joined, true),
        text: "<@U0C75BWRQKZ|Yash Gupta> has joined the channel",
      },
      {
        ...record("C0TESTAAA", labelled, true),
        text: "<@U0C75BWRQKZ|Yash Gupta> please review",
      },
    ]),
    "reply",
    `${searchText()} C0TESTAAA ${joined} ${labelled}`,
  );
  await runSlackRound();
  assert.equal(store.getItem(`slack:C0TESTAAA:${joined}`), undefined);
  assert.equal(
    store.getItem(`slack:C0TESTAAA:${labelled}`)?.snippet,
    "@Yash Gupta please review",
  );
});

test("R20 two Run now calls in one tick start one round", async () => {
  stub(CONNECTED);
  const results = await Promise.all([runSlackNow(), runSlackNow()]);
  assert.deepEqual(results, ["started", "running"]);
  await settled();
  assert.equal(modelCalls(), 1);
});

test("R21 a round whose tool text labels a user shows that name in the item title", async () => {
  const fresh = `${NOW_S - 2}.000100`;
  const body = reply([
    {
      ...record("C0TESTAAA", fresh, true),
      text: "<@U0TESTME> please check",
    },
  ]);
  stub(
    CONNECTED,
    body,
    "reply",
    `${searchText()} C0TESTAAA ${fresh} <@U0TESTME|Me>`,
  );
  await runSlackRound();
  const item = store.getItem(`slack:C0TESTAAA:${fresh}`);
  assert.ok(item);
  assert.ok(item.title.includes("@Me please check"), item.title);
  assert.equal(item.snippet, "@Me please check");
});

const THREAD_REPLY = JSON.stringify({
  type: "result",
  is_error: false,
  result: JSON.stringify({
    messages: [{ author: "Ana", ts: "1790000100.000200", text: "look" }],
    truncated: false,
  }),
});

test("R22 two concurrent thread reads make one model call and a notools call rejects", async () => {
  stub(CONNECTED, THREAD_REPLY);
  const both = await Promise.all([
    readSlackThreadMcp("C0TESTAAA", "1790000100.000200"),
    readSlackThreadMcp("C0TESTAAA", "1790000100.000200"),
  ]);
  assert.equal(both[0], both[1]);
  assert.equal(modelCalls(), 1);
  stub(CONNECTED, THREAD_REPLY, "notools");
  for (const expected of [1, 2]) {
    await assert.rejects(readSlackThreadMcp("C0TESTAAA", "1790000100.000200"));
    assert.equal(modelCalls(), expected);
  }
});

test("R23 the channel list cache lasts 10 minutes", async () => {
  const start = Date.now();
  let now = start;
  const clock = mock.method(Date, "now", () => now);
  try {
    stub(
      CONNECTED,
      JSON.stringify({
        type: "result",
        is_error: false,
        result: JSON.stringify({
          channels: [{ id: "C0TESTAAA", name: "dispatch-test-a" }],
        }),
      }),
    );
    await listSlackChannelsMcp();
    now = start + 599_999;
    await listSlackChannelsMcp();
    assert.equal(modelCalls(), 1);
    assert.equal(cachedSlackChannelName("C0TESTAAA"), "dispatch-test-a");
    now = start + 600_000;
    assert.equal(cachedSlackChannelName("C0TESTAAA"), undefined);
    await listSlackChannelsMcp();
    assert.equal(modelCalls(), 2);
  } finally {
    clock.mock.restore();
  }
});

test("R24 Run now with no claude on PATH answers not-connected and makes no call", async () => {
  const bare = path.join(env.root, "bare");
  fs.mkdirSync(bare);
  fs.symlinkSync("/usr/bin/which", path.join(bare, "which"));
  stub(CONNECTED);
  const saved = process.env.PATH;
  process.env.PATH = bare;
  try {
    assert.equal(await runSlackNow(), "not-connected");
    await settled();
    const status = await slackMcpStatus();
    assert.equal(status.lastError, "claude-missing");
    assert.equal(status.connector, "claude-missing");
    assert.equal(log("calls.log"), "");
  } finally {
    process.env.PATH = saved;
  }
});
