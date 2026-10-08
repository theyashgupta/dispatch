import { run } from "../../adapters/exec.js";
import { DISPATCH_DIR } from "../infra/paths.js";

export type ConnectorCheck =
  | { state: "connected"; server: string }
  | { state: "needs-auth" | "failed"; server: string }
  | { state: "not-found" };

type FoundCheck = Exclude<ConnectorCheck, { state: "not-found" }>;

const LIST_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 5_000;
const CLAUDE_AI_PREFIX = "claude.ai ";

/**
 * Read the connection state of one `claude mcp list` line, or null when its server name misses `pattern`.
 *
 * @remarks Only the name before the first ": " is matched, so a command line that mentions the
 * connector in its arguments never counts as the connector.
 */
function parseLine(line: string, pattern: RegExp): FoundCheck | null {
  const sep = line.indexOf(": ");
  if (sep < 0) return null;
  const server = line.slice(0, sep).trim();
  if (!pattern.test(server)) return null;
  if (/✔\s*Connected/.test(line)) return { state: "connected", server };
  if (line.includes("Needs authentication")) {
    return { state: "needs-auth", server };
  }
  return { state: "failed", server };
}

/**
 * Find the first server whose name matches `pattern` in `claude mcp list` output and read its state.
 */
export function parseMcpList(stdout: string, pattern: RegExp): ConnectorCheck {
  for (const line of stdout.split("\n")) {
    const check = parseLine(line, pattern);
    if (check !== null) return check;
  }
  return { state: "not-found" };
}

/**
 * Pick the best server whose name matches `pattern`: connected first, then a `claude.ai` server, then list order.
 *
 * @remarks A plugin copy of a connector can need auth while the account connector is connected, so
 * the first match is not always the one a round can use.
 */
export function pickConnector(stdout: string, pattern: RegExp): ConnectorCheck {
  let best: ConnectorCheck = { state: "not-found" };
  let bestRank = -1;
  for (const line of stdout.split("\n")) {
    const check = parseLine(line, pattern);
    if (check === null) continue;
    const rank =
      (check.state === "connected" ? 2 : 0) +
      (check.server.startsWith(CLAUDE_AI_PREFIX) ? 1 : 0);
    if (rank > bestRank) {
      best = check;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * The tool name prefix of one MCP server; as an `--allowedTools` entry it allows every tool of the server.
 */
export function mcpToolPrefix(server: string): string {
  return `mcp__${server.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * Run `claude mcp list` and return its stdout, throwing on a timeout or an abort.
 */
export async function readMcpList(
  claude: string,
  signal?: AbortSignal,
): Promise<string> {
  const list = await run(claude, ["mcp", "list"], {
    cwd: DISPATCH_DIR,
    timeout: LIST_TIMEOUT_MS,
    signal,
    killEscalationMs: KILL_GRACE_MS,
  });
  return list.stdout;
}
