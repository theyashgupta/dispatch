import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONNECTOR_CALL_ENV,
  connectorCallArgs,
  connectorLoaded,
} from "./connector-call.js";

const after = (args: string[], flag: string): string | undefined =>
  args[args.indexOf(flag) + 1];

test("CC1 the text call isolates the settings and allows only the given tools", () => {
  const args = connectorCallArgs({
    allowed: ["mcp__claude_ai_Granola"],
    outputFormat: "text",
  });
  assert.deepEqual(args, [
    "-p",
    "--setting-sources",
    "",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--output-format",
    "text",
    "--model",
    "sonnet",
    "--tools",
    "",
    "--allowedTools",
    "mcp__claude_ai_Granola",
    "--no-session-persistence",
  ]);
  assert.ok(!args.includes("--restricted"));
  assert.ok(!args.includes("--verbose"));
  assert.ok(!args.includes("--disallowedTools"));
  assert.equal(after(args, "--setting-sources"), "");
  assert.equal(after(args, "--permission-mode"), "dontAsk");
  assert.equal(after(args, "--permission-prompts"), "none");
  assert.equal(after(args, "--tools"), "");
});

test("CC2 the stream-json call adds --verbose", () => {
  const args = connectorCallArgs({
    allowed: ["a", "b"],
    outputFormat: "stream-json",
  });
  assert.equal(after(args, "--output-format"), "stream-json");
  assert.equal(args[args.indexOf("--output-format") + 2], "--verbose");
  assert.equal(after(args, "--allowedTools"), "a,b");
});

test("CC3 a blocked list adds --disallowedTools before the session flag and an empty one adds nothing", () => {
  const withBlocked = connectorCallArgs({
    allowed: ["a"],
    blocked: ["x", "y"],
    outputFormat: "text",
  });
  assert.equal(after(withBlocked, "--disallowedTools"), "x,y");
  assert.equal(withBlocked.at(-1), "--no-session-persistence");
  assert.ok(
    withBlocked.indexOf("--disallowedTools") >
      withBlocked.indexOf("--allowedTools"),
  );
  const empty = connectorCallArgs({
    allowed: ["a"],
    blocked: [],
    outputFormat: "text",
  });
  assert.ok(!empty.includes("--disallowedTools"));
});

test("CC4 the call env makes the CLI wait for the connector list", () => {
  assert.equal(CONNECTOR_CALL_ENV.MCP_CONNECTION_NONBLOCKING, "false");
  assert.equal(CONNECTOR_CALL_ENV.CLAUDE_CODE_MCP_STARTUP_WAIT_MS, "60000");
  assert.equal(CONNECTOR_CALL_ENV.MCP_TIMEOUT, "60000");
});

const INIT_CONNECTED =
  '{"type":"system","subtype":"init","tools":["mcp__claude_ai_Slack__slack_read_user_profile"],"mcp_servers":[{"name":"claude.ai Slack","status":"connected"}]}';
const RESULT = '{"type":"result","is_error":false,"result":"OK"}';

test("CC5 an init that lists the server as connected is loaded", () => {
  assert.equal(
    connectorLoaded(`${INIT_CONNECTED}\n${RESULT}\n`, "claude.ai Slack"),
    true,
  );
});

test("CC6 a server that is not connected in the init is not loaded", () => {
  const init =
    '{"type":"system","subtype":"init","mcp_servers":[{"name":"claude.ai Slack","status":"needs-auth"}]}';
  assert.equal(connectorLoaded(init, "claude.ai Slack"), false);
});

test("CC7 an init with no entry for the server is not loaded", () => {
  const init =
    '{"type":"system","subtype":"init","mcp_servers":[{"name":"playwright","status":"connected"}]}';
  assert.equal(connectorLoaded(init, "claude.ai Slack"), false);
  assert.equal(
    connectorLoaded('{"type":"system","subtype":"init"}', "claude.ai Slack"),
    false,
  );
});

test("CC8 stdout with no init line is not loaded", () => {
  assert.equal(connectorLoaded(`${RESULT}\n`, "claude.ai Slack"), false);
  assert.equal(connectorLoaded("", "claude.ai Slack"), false);
});

test("CC9 blank and garbage lines before the init line are skipped", () => {
  assert.equal(
    connectorLoaded(
      `\nnot json\n   \n{"type":"assistant"}\n${INIT_CONNECTED}\n`,
      "claude.ai Slack",
    ),
    true,
  );
});

test("CC10 a connected server with none of its tools listed is not loaded", () => {
  const init =
    '{"type":"system","subtype":"init","tools":["mcp__claude_ai_Gmail__search"],"mcp_servers":[{"name":"claude.ai Slack","status":"connected"}]}';
  assert.equal(connectorLoaded(init, "claude.ai Slack"), false);
});
