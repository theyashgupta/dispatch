import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";
import { writeConnectorClaude } from "../../test-support/stub-claude.js";

const env = isolateEnv();
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-stub-"));
process.env.CONNECTOR_STUB_DIR = stubDir;
const { mcpToolPrefix, parseMcpList, pickConnector, readMcpList } =
  await import("./connector-list.js");

after(() => {
  delete process.env.CONNECTOR_STUB_DIR;
  fs.rmSync(stubDir, { recursive: true, force: true });
  env.cleanup();
});

const MACHINE_LIST = [
  "Checking MCP server health…",
  "",
  "claude.ai Claude Docs: https://docs.example/mcp - ✔ Connected",
  "plugin:chrome-devtools-mcp:chrome-devtools: npx chrome-devtools-mcp@1.9.0 - ✔ Connected",
  "plugin:claude-mem:mcp-search: node -e const f=require('fs');f.slack=1 - ✔ Connected",
  "plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication",
  "plugin:design:asana: https://mcp.asana.example/sse (HTTP) - ✘ Failed to connect - Incompatible auth server",
  "plugin:design:google calendar:  (HTTP) - - Not configured",
  "playwright: npx -y @playwright/mcp@latest - ✔ Connected",
].join("\n");

const CLAUDE_AI_CONNECTED =
  "claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected";
const CLAUDE_AI_NEEDS_AUTH =
  "claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication";
const SLACK = /slack/i;

test("C1: a connected claude.ai Slack line beats the plugin Slack line that needs auth", () => {
  assert.deepEqual(
    pickConnector(`${MACHINE_LIST}\n${CLAUDE_AI_CONNECTED}\n`, SLACK),
    { state: "connected", server: "claude.ai Slack" },
  );
});

test("C2: a connected plugin server beats a claude.ai server that needs auth", () => {
  const list = [
    "plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ✔ Connected",
    CLAUDE_AI_NEEDS_AUTH,
  ].join("\n");
  assert.deepEqual(pickConnector(list, SLACK), {
    state: "connected",
    server: "plugin:design:slack",
  });
});

test("C3: with two servers that need auth the claude.ai one wins", () => {
  assert.deepEqual(
    pickConnector(`${MACHINE_LIST}\n${CLAUDE_AI_NEEDS_AUTH}\n`, SLACK),
    { state: "needs-auth", server: "claude.ai Slack" },
  );
});

test("C4: this machine's list gives the plugin server needing auth, and a command argument alone gives not-found", () => {
  assert.deepEqual(pickConnector(MACHINE_LIST, SLACK), {
    state: "needs-auth",
    server: "plugin:design:slack",
  });
  const noSlackName = MACHINE_LIST.replace(
    /^plugin:design:slack:.*$/m,
    "plugin:design:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication",
  );
  assert.deepEqual(pickConnector(noSlackName, SLACK), { state: "not-found" });
});

test("C5: parseMcpList keeps the first match, so the new ranking does not change Granola", () => {
  assert.deepEqual(
    parseMcpList(`${MACHINE_LIST}\n${CLAUDE_AI_CONNECTED}\n`, SLACK),
    { state: "needs-auth", server: "plugin:design:slack" },
  );
});

test("C6: mcpToolPrefix turns the server name into the tool prefix", () => {
  assert.equal(mcpToolPrefix("claude.ai Slack"), "mcp__claude_ai_Slack");
});

test("C7: readMcpList returns the fixture text and logs one list read and no model call", async () => {
  const fake = writeConnectorClaude(env.binDir);
  fs.writeFileSync(
    path.join(stubDir, "mcp-list.txt"),
    `${MACHINE_LIST}\n${CLAUDE_AI_CONNECTED}\n`,
  );
  const text = await readMcpList(fake);
  assert.equal(text, `${MACHINE_LIST}\n${CLAUDE_AI_CONNECTED}\n`);
  const calls = fs.readFileSync(path.join(stubDir, "calls.log"), "utf8");
  assert.equal(calls, "mcp list\n");
});
