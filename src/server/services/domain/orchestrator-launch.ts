import path from "node:path";

export const ORCHESTRATOR_DISALLOWED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
] as const;

export const ORCHESTRATOR_BUILTIN_TOOLS = ["Read", "Glob", "Grep"] as const;

const BYPASS_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
]);
const OWNED_BOOLEAN_FLAGS = new Set(["--strict-mcp-config"]);
const OWNED_VALUE_FLAGS = new Set(["--model", "--permission-mode"]);
const OWNED_LIST_FLAGS = new Set([
  "--mcp-config",
  "--tools",
  "--allowedTools",
  "--allowed-tools",
  "--disallowedTools",
  "--disallowed-tools",
]);

/**
 * Remove every flag the orchestrator policy owns from configured Claude arguments.
 *
 * @remarks
 * A variadic flag such as the disallowed tools list takes every following token up to the next
 * option, so those values leave with it. The policy values then win over any Settings value.
 */
function stripOwnedFlags(args: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const name = arg.split("=", 1)[0];
    if (BYPASS_FLAGS.has(arg) || OWNED_BOOLEAN_FLAGS.has(arg)) continue;
    if (OWNED_VALUE_FLAGS.has(name) || OWNED_LIST_FLAGS.has(name)) {
      if (arg.includes("=")) continue;
      const variadic = OWNED_LIST_FLAGS.has(name);
      while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        i += 1;
        if (!variadic) break;
      }
      continue;
    }
    kept.push(arg);
  }
  return kept;
}

/**
 * Build the Claude arguments of an orchestrator session: the policy flags first, then the
 * configured arguments with every permission, model, MCP and tool flag removed.
 *
 * @remarks
 * The built-in tools are an allowlist of read-only tools, because a deny list misses any
 * other code-running tool. The permission mode is pinned so a user default mode cannot widen it,
 * and the board tools are allowed so each call runs without a permission dialog.
 */
export function orchestratorLaunchArgs(input: {
  model: string;
  mcpConfigPath: string;
  claudeArgs: string[];
}): { leadingArgs: string[]; claudeArgs: string[] } {
  return {
    leadingArgs: [
      "--model",
      input.model,
      "--mcp-config",
      input.mcpConfigPath,
      "--strict-mcp-config",
      "--tools",
      ...ORCHESTRATOR_BUILTIN_TOOLS,
      "--allowedTools",
      "mcp__dispatch",
      "--permission-mode",
      "manual",
      "--disallowedTools",
      ...ORCHESTRATOR_DISALLOWED_TOOLS,
    ],
    claudeArgs: stripOwnedFlags(input.claudeArgs),
  };
}

/** The MCP config file content that names the `dispatch mcp` command; it holds no token or env. */
export function orchestratorMcpConfig(input: {
  command: string;
  args: string[];
}): {
  mcpServers: { dispatch: { command: string; args: string[] } };
} {
  return {
    mcpServers: { dispatch: { command: input.command, args: input.args } },
  };
}

export function orchestratorSessionEnv(input: {
  token: string;
  port: number;
}): Record<string, string> {
  return {
    DISPATCH_ORCHESTRATOR_TOKEN: input.token,
    DISPATCH_PORT: String(input.port),
  };
}

export function orchestratorMcpConfigPath(
  dataDir: string,
  boardKey: string,
  orchestratorId: string,
): string {
  return path.join(
    dataDir,
    "orchestrators",
    `${boardKey}-${orchestratorId}.mcp.json`,
  );
}
