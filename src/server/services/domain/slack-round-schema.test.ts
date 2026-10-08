import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseChannelsOutput,
  parseRoundOutput,
  parseThreadOutput,
  mentionNames,
  selectRoundRecords,
  type SlackEvidence,
  type SlackRoundMessage,
} from "./slack-round-schema.js";

const ORIGIN = "https://dispatch-test.slack.com/archives/";
const SINCE = new Date(1789999000 * 1000);
const UNTIL = new Date(1790000400 * 1000);

function message(
  conversationId: string,
  ts: string,
  isMention: boolean,
  permalink = `${ORIGIN}${conversationId}/p1`,
): Record<string, unknown> {
  return {
    conversationId,
    ts,
    author: "Test User",
    text: "hello",
    permalink,
    isMention,
  };
}

const RECORDS = [
  message("D0TESTDM1", "1790000000.000100", false),
  message("C0TESTAAA", "1790000100.000200", true),
  message("C0TESTAAA", "1790000200.000300", false),
  message("C0TESTZZZ", "1790000300.000400", true),
  message("D0TESTDM1", "1790000000.000100", false),
];

const EMPTY_RESULT = {
  type: "result",
  is_error: false,
  result: '{"messages":[]}',
};

const PREFIX = "mcp__claude_ai_Slack__slack_";
const TOOL = `${PREFIX}read_thread`;
const SEARCH = `${PREFIX}search_public_and_private`;
const PROFILE = `${PREFIX}read_user_profile`;
const CHANNELS = `${PREFIX}list_user_channels`;
const TOOLS = [TOOL];
function evidenceOf(rows: readonly Record<string, unknown>[]): string[] {
  return [
    rows.map((r) => `${String(r.conversationId)} ${String(r.ts)}`).join(" "),
  ];
}

const EVIDENCE_TEXT = evidenceOf(RECORDS).join(" ");
const ev = (text: string): SlackEvidence => ({ input: "{}", text });

function lines(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

const INIT = { type: "system", subtype: "init", tools: TOOLS };
const USE = {
  type: "assistant",
  message: { content: [{ type: "tool_use", id: "t1", name: TOOL, input: {} }] },
};

function seen(
  text: string,
  id = "t1",
  isError = false,
): Record<string, unknown> {
  return {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: [{ type: "text", text }],
          is_error: isError,
        },
      ],
    },
  };
}

function calls(
  used: {
    name: string;
    text: string;
    error?: boolean;
    input?: Record<string, unknown>;
  }[],
  result: Record<string, unknown> = EMPTY_RESULT,
): string {
  return lines(
    { ...INIT, tools: used.map((u) => u.name) },
    {
      type: "assistant",
      message: {
        content: used.map((u, i) => ({
          type: "tool_use",
          id: `u${i}`,
          name: u.name,
          input: u.input ?? {},
        })),
      },
    },
    ...used.map((u, i) => seen(u.text, `u${i}`, u.error === true)),
    result,
  );
}

function envelope(result: string, extra: Record<string, unknown> = {}): string {
  return lines(INIT, USE, seen(EVIDENCE_TEXT), {
    type: "result",
    is_error: false,
    result,
    total_cost_usd: 0.106,
    duration_ms: 18000,
    ...extra,
  });
}

const WINDOW = {
  since: SINCE,
  until: UNTIL,
  evidence: [ev(EVIDENCE_TEXT)],
};

function valid(): string {
  return envelope(JSON.stringify({ messages: RECORDS }));
}

function parsed(stdout: string): SlackRoundMessage[] {
  const out = parseRoundOutput(stdout, TOOLS);
  assert.ok(out.ok);
  return out.messages;
}

test("S1 the valid envelope parses with 5 messages, cost and duration", () => {
  const out = parseRoundOutput(valid(), TOOLS);
  assert.ok(out.ok);
  assert.equal(out.messages.length, 5);
  assert.equal(out.costUsd, 0.106);
  assert.equal(out.durationMs, 18000);
});

test("S2 a record with no ts is dropped and counted, and the round stands", () => {
  const noTs = { ...RECORDS[0] };
  delete noTs.ts;
  const out = parseRoundOutput(
    envelope(JSON.stringify({ messages: [noTs, RECORDS[1]] })),
    TOOLS,
  );
  assert.ok(out.ok);
  assert.equal(out.invalid, 1);
  assert.deepEqual(out.messages, [parsed(valid())[1]]);
});

test("S3 isMention as a string is dropped and counted", () => {
  const bad = { ...RECORDS[1], isMention: "yes" };
  const out = parseRoundOutput(
    envelope(JSON.stringify({ messages: [bad] })),
    TOOLS,
  );
  assert.ok(out.ok);
  assert.equal(out.messages.length, 0);
  assert.equal(out.invalid, 1);
});

test("S3b a body that is not an object with a messages array is invalid output", () => {
  for (const body of ['{"items":[]}', '{"messages":"x"}', "[]"]) {
    assert.deepEqual(parseRoundOutput(envelope(body), TOOLS), {
      ok: false,
      reason: "invalid",
    });
  }
});

test("S4 is_error true fails", () => {
  const out = parseRoundOutput(
    envelope(JSON.stringify({ messages: [] }), { is_error: true }),
    TOOLS,
  );
  assert.equal(out.ok, false);
});

test("S5 a result that is not JSON fails, as does a stdout that is not JSON", () => {
  assert.equal(parseRoundOutput(envelope("no data here"), TOOLS).ok, false);
  assert.equal(parseRoundOutput("not an envelope", TOOLS).ok, false);
});

test("S6 a fenced result parses", () => {
  const body = JSON.stringify({ messages: RECORDS });
  assert.equal(parsed(envelope(`\`\`\`json\n${body}\n\`\`\``)).length, 5);
  assert.equal(parsed(envelope(`\`\`\`\n${body}\n\`\`\``)).length, 5);
});

test("S6b an empty round parses and an unknown key is dropped", () => {
  assert.deepEqual(parsed(envelope('{"messages":[]}')), []);
  const extra = { ...RECORDS[0], secret: "x" };
  const [first] = parsed(envelope(JSON.stringify({ messages: [extra] })));
  assert.equal("secret" in (first as object), false);
});

test("S6c a bad conversation id or a bad ts drops that record only", () => {
  for (const bad of [
    { ...RECORDS[0], conversationId: "X0TESTDM1" },
    { ...RECORDS[0], ts: "12.3456789" },
    { ...RECORDS[0], threadTs: "soon" },
    { ...RECORDS[0], author: 7 },
  ]) {
    const out = parseRoundOutput(
      envelope(JSON.stringify({ messages: [bad, RECORDS[1]] })),
      TOOLS,
    );
    assert.ok(out.ok);
    assert.equal(out.invalid, 1);
    assert.equal(out.messages.length, 1);
  }
});

test("S7 the DM and the picked mention stay, the other three drop", () => {
  const picked = [{ id: "C0TESTAAA", name: "dispatch-test-a" }];
  const kept = selectRoundRecords(parsed(valid()), picked, WINDOW).records;
  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.map((r) => [r.type, r.conversation, r.channelId, r.channelName]),
    [
      ["dm", "im", "D0TESTDM1", ""],
      ["mention", "channel", "C0TESTAAA", "dispatch-test-a"],
    ],
  );
});

test("S7b with no channel picked only the DM stays", () => {
  const kept = selectRoundRecords(parsed(valid()), [], WINDOW).records;
  assert.deepEqual(
    kept.map((r) => r.channelId),
    ["D0TESTDM1"],
  );
});

test("S7c a thread ts reaches the item input", () => {
  const withThread = { ...RECORDS[0], threadTs: "1790000000.000050" };
  const [record] = selectRoundRecords(
    parsed(envelope(JSON.stringify({ messages: [withThread] }))),
    [],
    WINDOW,
  ).records;
  assert.equal(record?.message.thread_ts, "1790000000.000050");
});

test("S8 the origin is the first search tool permalink, with escaped slashes undone", () => {
  const hit = (host: string, id: string): string =>
    `{"results":"Permalink: [link](https:\\/\\/${host}.slack.com\\/archives\\/${id}\\/p1)"}`;
  const out = (text: string, name = SEARCH): string =>
    calls([
      { name, text },
      { name: TOOL, text: EVIDENCE_TEXT },
    ]);
  const origin = (stdout: string) => {
    const round = parseRoundOutput(stdout, [SEARCH, TOOL]);
    assert.ok(round.ok);
    return round.origin;
  };
  assert.equal(
    origin(out(`${hit("ws-one", "C0AAA")} ${hit("ws-two", "C0BBB")}`)),
    "https://ws-one.slack.com",
  );
  assert.equal(
    origin(out("see https://ws-plain.slack.com/archives/C0AAA/p1")),
    "https://ws-plain.slack.com",
  );
  assert.equal(origin(out(hit("ws-one", "C0AAA"), TOOL)), undefined);
  for (const text of [
    "http://ws-one.slack.com/archives/C0AAA/p1",
    "https://evil.example/archives/C0AAA/p1",
    "https://ws-one.slack.com.evil.example/archives/C0AAA/p1",
    "https://ws-one.slack.com/client/T1",
  ]) {
    assert.equal(origin(out(text)), undefined, text);
  }
});

test("S8b the model permalink never sets the origin", () => {
  const round = parseRoundOutput(
    envelope(JSON.stringify({ messages: RECORDS })),
    TOOLS,
  );
  assert.ok(round.ok);
  assert.equal(round.origin, undefined);
});

const wrap = (body: unknown): string => envelope(JSON.stringify(body));

const channelsOut = (body: unknown): string =>
  calls([{ name: CHANNELS, text: "channels" }], {
    ...EMPTY_RESULT,
    result: JSON.stringify(body),
  });

test("a thread output keeps 40 messages and marks the cut as truncated", () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    author: "Ana",
    ts: `17900001${String(i).padStart(2, "0")}.000100`,
    text: "x",
  }));
  const out = parseThreadOutput(wrap({ messages: rows }), TOOLS);
  assert.equal(out.messages.length, 40);
  assert.equal(out.truncated, true);
  assert.equal(
    parseThreadOutput(wrap({ messages: rows.slice(0, 2) }), TOOLS).truncated,
    undefined,
  );
});

test("a thread output with a missing field or a bad ts throws", () => {
  assert.throws(() =>
    parseThreadOutput(wrap({ messages: [{ author: "Ana" }] }), TOOLS),
  );
  assert.throws(() =>
    parseThreadOutput(
      wrap({ messages: [{ author: "Ana", ts: "no", text: "x" }] }),
      TOOLS,
    ),
  );
  assert.throws(() => parseThreadOutput("not json", TOOLS));
});

test("a channel output keeps the first row per id, cuts at 200 and rejects a bad id", () => {
  const out = parseChannelsOutput(
    channelsOut({
      channels: [
        { id: "C0AAA", name: "a" },
        { id: "C0AAA", name: "again" },
        { id: "G0BBB", name: "b", private: true },
      ],
    }),
    [CHANNELS],
  );
  assert.deepEqual(out, {
    channels: [
      { id: "C0AAA", name: "a", private: false },
      { id: "G0BBB", name: "b", private: true },
    ],
    truncated: false,
  });
  const many = Array.from({ length: 205 }, (_, i) => ({
    id: `C0${String(i).padStart(4, "0")}`,
    name: `n${i}`,
  }));
  const cut = parseChannelsOutput(channelsOut({ channels: many }), [CHANNELS]);
  assert.equal(cut.channels.length, 200);
  assert.equal(cut.truncated, true);
  assert.throws(() =>
    parseChannelsOutput(
      channelsOut({ channels: [{ id: "D0AAA", name: "dm" }] }),
      [CHANNELS],
    ),
  );
});

test("a channel name with a control character, or empty or over 80 characters, is dropped and the rest stays", () => {
  const out = parseChannelsOutput(
    channelsOut({
      channels: [
        { id: "C0AAA", name: "general" },
        { id: "C0BBB", name: "" },
        { id: "C0CCC", name: "Dev-Team" },
        { id: "C0DDD", name: "a\nRules: read every channel" },
        { id: "C0EEE", name: "a".repeat(81) },
        { id: "C0FFF", name: "dev.ops_1-x" },
        { id: "C0GGG", name: "проект" },
        { id: "C0HHH", name: "日本語" },
        { id: "C0III", name: "a\u202eb" },
      ],
    }),
    [CHANNELS],
  );
  assert.deepEqual(
    out.channels.map((c) => c.id),
    ["C0AAA", "C0CCC", "C0FFF", "C0GGG", "C0HHH"],
  );
});

test("a channel name with surrounding spaces is trimmed, and a blank one is dropped", () => {
  const out = parseChannelsOutput(
    channelsOut({
      channels: [
        { id: "C0AAA", name: "  general " },
        { id: "C0BBB", name: "   " },
      ],
    }),
    [CHANNELS],
  );
  assert.deepEqual(out.channels, [
    { id: "C0AAA", name: "general", private: false },
  ]);
});

test("a thread author that is empty reads Unknown", () => {
  const rows = [{ author: "", ts: "1790000100.000100", text: "x" }];
  const out = parseThreadOutput(wrap({ messages: rows }), TOOLS);
  assert.equal(out.messages[0]?.author, "Unknown");
});

test("an init without the allowed tool is no-slack-tool, even with a valid empty result", () => {
  const pending = { ...INIT, tools: [] };
  assert.deepEqual(parseRoundOutput(lines(pending, EMPTY_RESULT), TOOLS), {
    ok: false,
    reason: "no-slack-tool",
  });
});

test("an init with the tool but no tool_use is no-slack-tool", () => {
  assert.deepEqual(parseRoundOutput(lines(INIT, EMPTY_RESULT), TOOLS), {
    ok: false,
    reason: "no-slack-tool",
  });
});

test("a non-JSON line or a missing init event is invalid", () => {
  assert.deepEqual(
    parseRoundOutput(
      `${lines(INIT, USE)}\nnot json\n${lines(EMPTY_RESULT)}`,
      TOOLS,
    ),
    { ok: false, reason: "invalid" },
  );
  assert.deepEqual(parseRoundOutput(lines(USE, EMPTY_RESULT), TOOLS), {
    ok: false,
    reason: "invalid",
  });
});

test("blank lines are skipped and the last result event wins", () => {
  const stale = { ...EMPTY_RESULT, result: "no data here" };
  const out = parseRoundOutput(
    `\n${lines(INIT, USE, seen(EVIDENCE_TEXT), stale)}\n\n${lines(EMPTY_RESULT)}\n`,
    TOOLS,
  );
  assert.ok(out.ok);
  assert.equal(out.messages.length, 0);
});

test("a thread or channel output without a Slack tool throws", () => {
  const out = lines({ ...INIT, tools: [] }, EMPTY_RESULT);
  assert.throws(() => parseThreadOutput(out, TOOLS));
  assert.throws(() => parseChannelsOutput(out, TOOLS));
});

const ROUND_TOOLS = [PROFILE, SEARCH, TOOL];

function failure(stdout: string, tools = ROUND_TOOLS) {
  return parseRoundOutput(stdout, tools);
}

test("S9 an error result beside a good read keeps the call and reports the count and the first text", () => {
  const long = "x".repeat(300);
  const mixed = calls([
    { name: TOOL, text: EVIDENCE_TEXT },
    { name: SEARCH, text: long, error: true },
    { name: PROFILE, text: "second", error: true },
  ]);
  const out = failure(mixed);
  assert.ok(out.ok);
  assert.equal(out.toolErrors, 2);
  assert.equal(out.firstToolError, "x".repeat(200));
  assert.deepEqual(out.evidence, [ev(EVIDENCE_TEXT)]);
  const good = failure(
    calls([
      { name: TOOL, text: EVIDENCE_TEXT },
      { name: SEARCH, text: "fine" },
    ]),
  );
  assert.ok(good.ok);
  assert.equal(good.toolErrors, 0);
  assert.equal(good.firstToolError, undefined);
});

test("S10 a permission denial is counted and does not fail the call", () => {
  const denied = calls([{ name: TOOL, text: EVIDENCE_TEXT }], {
    ...EMPTY_RESULT,
    permission_denials: [{ tool_name: "x" }, { tool_name: "y" }],
  });
  const out = failure(denied);
  assert.ok(out.ok);
  assert.equal(out.denials, 2);
  const none = failure(
    calls([{ name: TOOL, text: EVIDENCE_TEXT }], {
      ...EMPTY_RESULT,
      permission_denials: [],
    }),
  );
  assert.ok(none.ok);
  assert.equal(none.denials, 0);
});

test("S11 a call with no successful data read fails, per call kind", () => {
  const profileOnly = calls([{ name: PROFILE, text: "U1" }]);
  assert.deepEqual(failure(profileOnly), {
    ok: false,
    reason: "no-slack-tool",
  });
  const failedRead = calls([
    { name: PROFILE, text: "U1" },
    { name: TOOL, text: "boom", error: true },
  ]);
  assert.deepEqual(failure(failedRead), { ok: false, reason: "no-slack-tool" });
  const listed = calls([{ name: CHANNELS, text: "c" }]);
  assert.deepEqual(failure(listed, [CHANNELS]), {
    ok: false,
    reason: "no-slack-tool",
  });
  assert.throws(() => parseThreadOutput(listed, [CHANNELS]));
  const threadOnly = calls([{ name: TOOL, text: "t" }], {
    ...EMPTY_RESULT,
    result: '{"channels":[]}',
  });
  assert.throws(() => parseChannelsOutput(threadOnly, [TOOL]));
});

test("S12 an empty threadTs, a null threadTs and a missing one all read as absent", () => {
  for (const threadTs of ["", null, undefined]) {
    const out = parsed(
      envelope(JSON.stringify({ messages: [{ ...RECORDS[0], threadTs }] })),
    );
    assert.equal(out[0]?.threadTs, undefined);
  }
});

test("S13 an empty, null or missing permalink reads as absent", () => {
  for (const permalink of ["", null, undefined]) {
    const out = parsed(
      envelope(JSON.stringify({ messages: [{ ...RECORDS[0], permalink }] })),
    );
    assert.equal(out[0]?.permalink, undefined);
  }
});

test("S14 an empty, null or missing author reads Unknown and a long one is cut to 80", () => {
  for (const author of ["", null, undefined]) {
    const out = parsed(
      envelope(JSON.stringify({ messages: [{ ...RECORDS[0], author }] })),
    );
    assert.equal(out[0]?.author, "Unknown");
  }
  const long = parsed(
    envelope(
      JSON.stringify({
        messages: [{ ...RECORDS[0], author: "a".repeat(120) }],
      }),
    ),
  );
  assert.equal(long[0]?.author, "a".repeat(80));
});

test("S15 a record whose ts is in no tool result is dropped and counted", () => {
  const picked = [{ id: "C0TESTAAA", name: "dispatch-test-a" }];
  const out = selectRoundRecords(parsed(valid()), picked, {
    ...WINDOW,
    evidence: [ev("D0TESTDM1 1790000000.000100")],
  });
  assert.deepEqual(
    out.records.map((r) => r.message.ts),
    ["1790000000.000100"],
  );
  assert.equal(out.unseen, 1);
});

test("S15b a ts that appears only in a result for another conversation is dropped", () => {
  const out = selectRoundRecords(parsed(valid()), [], {
    ...WINDOW,
    evidence: [
      ev("C0TESTAAA 1790000000.000100"),
      ev("D0TESTDM1 1790000999.000001"),
    ],
  });
  assert.deepEqual(out.records, []);
  assert.equal(out.unseen, 1);
  const together = selectRoundRecords(parsed(valid()), [], {
    ...WINDOW,
    evidence: [
      ev("C0TESTAAA 1790000000.000100"),
      ev("D0TESTDM1 1790000000.000100"),
    ],
  });
  assert.equal(together.records.length, 1);
});

test("S15c an error result gives no evidence", () => {
  const out = parseRoundOutput(
    calls(
      [
        { name: TOOL, text: "ok" },
        { name: SEARCH, text: EVIDENCE_TEXT, error: true },
      ],
      { ...EMPTY_RESULT, result: JSON.stringify({ messages: RECORDS }) },
    ),
    ROUND_TOOLS,
  );
  assert.ok(out.ok);
  assert.deepEqual(out.evidence, [ev("ok")]);
  assert.deepEqual(
    selectRoundRecords(out.messages, [], { ...WINDOW, evidence: out.evidence })
      .records,
    [],
  );
});

test("S15d a thread result that names no channel counts through its tool call input", () => {
  const reply = message("C0TESTAAA", "1790000100.000200", true);
  const out = parseRoundOutput(
    calls(
      [
        {
          name: TOOL,
          text: "Thread reply\nMessage TS: 1790000100.000200",
          input: { channel_id: "C0TESTAAA", message_ts: "1790000000.000100" },
        },
      ],
      { ...EMPTY_RESULT, result: JSON.stringify({ messages: [reply] }) },
    ),
    ROUND_TOOLS,
  );
  assert.ok(out.ok);
  const kept = selectRoundRecords(
    out.messages,
    [{ id: "C0TESTAAA", name: "qa-alpha" }],
    { ...WINDOW, evidence: out.evidence },
  );
  assert.equal(kept.records.length, 1);
  assert.equal(kept.unseen, 0);
});

test("S15e a ts found only in a call input is not evidence", () => {
  const out = selectRoundRecords(
    [message("D0FAKEDM1", "1790000100.000200", false) as SlackRoundMessage],
    [],
    {
      ...WINDOW,
      evidence: [
        {
          input: '{"channel_id":"D0FAKEDM1","latest":"1790000100.000200"}',
          text: "No messages found",
        },
      ],
    },
  );
  assert.deepEqual(out.records, []);
  assert.equal(out.unseen, 1);
});

test("S15f a ts without its fraction does not match the full ts", () => {
  const out = selectRoundRecords(
    [message("D0TESTDM1", "1790000100", false) as SlackRoundMessage],
    [],
    { ...WINDOW, evidence: [ev("D0TESTDM1 1790000100.000200")] },
  );
  assert.deepEqual(out.records, []);
  const whole = selectRoundRecords(
    [message("D0TESTDM1", "1790000100.000200", false) as SlackRoundMessage],
    [],
    { ...WINDOW, evidence: [ev("D0TESTDM1 1790000100.000200.")] },
  );
  assert.equal(whole.records.length, 1);
});

test("S16 a record outside the round window is dropped, the edges stay", () => {
  const at = (sec: number) => `${sec}.000000`;
  const rows = [
    message("D0TESTDM1", at(1788999999), false),
    message("D0TESTDM1", at(1789999000), false),
    message("D0TESTDM1", at(1790000400), false),
    message("D0TESTDM1", at(1790000401), false),
  ] as SlackRoundMessage[];
  const out = selectRoundRecords(rows, [], {
    since: SINCE,
    until: UNTIL,
    evidence: evidenceOf(rows).map(ev),
  });
  assert.deepEqual(
    out.records.map((r) => r.message.ts),
    [at(1789999000), at(1790000400)],
  );
});

test("S17 a join or leave line is dropped and other mention text stays", () => {
  const texts = [
    "<@U0C75BWRQKZ|Yash Gupta> has joined the channel",
    "<@U0C75BWRQKZ> has left the channel.",
    "<@U0C75BWRQKZ|Yash> please review, has joined the channel",
    "<@U0C75BWRQKZ|Yash Gupta> please review the board",
  ];
  const rows = texts.map((text, i) => ({
    ...message("D0TESTDM1", `179000010${i}.000100`, false),
    text,
  })) as SlackRoundMessage[];
  const out = selectRoundRecords(rows, [], {
    ...WINDOW,
    evidence: evidenceOf(rows).map(ev),
  });
  assert.deepEqual(
    out.records.map((r) => r.message.text),
    [texts[2], texts[3]],
  );
});

test("S20 mention names come from the labels in the tool results", () => {
  const names = mentionNames([
    ev("<@U0C75BWRQKZ|Yash Gupta> please review the board"),
    ev("<@U0C75BWRQKZ|Other> and <@U0TESTTWO|Bo>"),
    ev("<@U0NOLABEL> plain"),
  ]);
  assert.deepEqual(
    [...names],
    [
      ["U0C75BWRQKZ", "Yash Gupta"],
      ["U0TESTTWO", "Bo"],
    ],
  );
});
