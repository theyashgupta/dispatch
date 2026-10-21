import { run } from "../../adapters/exec.js";
import { DISPATCH_DIR } from "../infra/paths.js";
import { managedClaudeEnv } from "./claude-accounts.js";
import { mcpToolPrefix } from "./connector-list.js";

const KILL_GRACE_MS = 5_000;

export const CONNECTOR_CALL_ENV = {
  MCP_CONNECTION_NONBLOCKING: "false",
  CLAUDE_CODE_MCP_STARTUP_WAIT_MS: "60000",
  MCP_TIMEOUT: "60000",
} as const;

/**
 * Whether the init event of a stream-json call lists the server as connected with at least one of its tools.
 *
 * @remarks The init event lists the MCP servers and tools the call loaded, so this reads whether the
 * connector reached the call without trusting model text. A server can read connected before its tools
 * are listed, and the round needs the tools.
 */
export function connectorLoaded(stdout: string, server: string): boolean {
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const init = event as {
      type?: unknown;
      subtype?: unknown;
      mcp_servers?: unknown;
      tools?: unknown;
    } | null;
    if (init?.type !== "system" || init.subtype !== "init") continue;
    const prefix = `${mcpToolPrefix(server)}__`;
    return (
      Array.isArray(init.mcp_servers) &&
      init.mcp_servers.some(
        (entry: { name?: unknown; status?: unknown } | null) =>
          entry?.name === server && entry.status === "connected",
      ) &&
      Array.isArray(init.tools) &&
      init.tools.some(
        (tool: unknown) => typeof tool === "string" && tool.startsWith(prefix),
      )
    );
  }
  return false;
}

/**
 * The argv of one isolated `claude -p` call that may use only the given connector tools.
 *
 * @remarks The empty setting sources keep the user's settings files, allow rules and default mode out
 * of the call. The empty tools list plus `dontAsk` make the allowed list the whole reach of the model.
 */
export function connectorCallArgs(input: {
  allowed: readonly string[];
  blocked?: readonly string[];
  outputFormat: "text" | "stream-json";
}): string[] {
  return [
    "-p",
    "--setting-sources",
    "",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--output-format",
    input.outputFormat,
    ...(input.outputFormat === "stream-json" ? ["--verbose"] : []),
    "--model",
    "sonnet",
    "--tools",
    "",
    "--allowedTools",
    input.allowed.join(","),
    ...(input.blocked !== undefined && input.blocked.length > 0
      ? ["--disallowedTools", input.blocked.join(",")]
      : []),
    "--no-session-persistence",
  ];
}

/**
 * Run one isolated `claude -p` connector call and return its stdout.
 *
 * @remarks `MCP_CONNECTION_NONBLOCKING=false` makes the CLI wait for the claude.ai connector list before
 * the first turn; without it a fast start races the fetch and sees no connector tool.
 */
export async function runConnectorCall(
  claude: string,
  input: {
    allowed: readonly string[];
    blocked?: readonly string[];
    outputFormat: "text" | "stream-json";
    prompt: string;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<string> {
  const managedEnv = managedClaudeEnv();
  const { stdout } = await run(claude, connectorCallArgs(input), {
    cwd: DISPATCH_DIR,
    timeout: input.timeoutMs + KILL_GRACE_MS,
    maxBuffer: 10 * 1024 * 1024,
    signal: input.signal,
    killEscalationMs: KILL_GRACE_MS,
    input: input.prompt,
    env: { ...CONNECTOR_CALL_ENV, ...managedEnv },
  });
  return stdout;
}
