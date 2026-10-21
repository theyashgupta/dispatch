import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after as afterAll, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";
import { writeConnectorClaude } from "../../test-support/stub-claude.js";

const env = isolateEnv();
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-call-stub-"));
process.env.CONNECTOR_STUB_DIR = stubDir;
const {
  CONNECTOR_CALL_ENV,
  connectorCallArgs,
  connectorLoaded,
  runConnectorCall,
} = await import("./connector-call.js");
const accounts = await import("./claude-accounts.js");

afterAll(() => {
  delete process.env.CONNECTOR_STUB_DIR;
  fs.rmSync(stubDir, { recursive: true, force: true });
  env.cleanup();
});

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

test("CC11 runConnectorCall runs on the home login without a managed default and on the managed dir with one", async () => {
  const fake = writeConnectorClaude(env.binDir);
  fs.writeFileSync(path.join(stubDir, "reply.json"), "{}");
  const log = path.join(stubDir, "config-dir.log");
  fs.rmSync(log, { force: true });
  const call = () =>
    runConnectorCall(fake, {
      allowed: ["mcp__claude_ai_Slack"],
      outputFormat: "text",
      prompt: "hi",
      timeoutMs: 10_000,
    });
  await call();
  const id = "44444444-4444-4444-8444-444444444444";
  const dir = accounts.accountDir(id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  await accounts.adoptManagedDefault({
    id,
    email: "managed@example.com",
    orgId: "org-x",
    orgName: "Org X",
    subscriptionType: "pro",
    createdAt: "2026-09-02T00:00:00.000Z",
    lastLoginAt: "2026-09-02T00:00:00.000Z",
  });
  try {
    await call();
  } finally {
    await accounts.removeAccount(id);
  }
  assert.equal(
    fs.readFileSync(log, "utf8"),
    `${process.env.CLAUDE_CONFIG_DIR ?? ""}\n${dir}\n`,
  );
});
