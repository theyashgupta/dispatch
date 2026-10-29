import path from "node:path";
import type { OrchestratorKind } from "../../../shared/types.js";

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
 * other code-running tool. The session runs unattended, so it skips permission prompts; the
 * allowlist and the disallowed tools still limit it to read-only and board tools.
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
      "--dangerously-skip-permissions",
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

const FEATURE_RULES = [
  "1. Act only on the cards that are assigned to you. Do not look for work in the To Do column.",
  "2. A typed direction that names other cards is a request to assign them to you. Call assign_card for each card that the direction names. Then act on the card. assign_card accepts only a card in To Do.",
  "3. Never start, stop or ship a card that is not assigned to you. Ship your assigned cards with the ship procedure of the rule book.",
  "4. An intake_submitted event with your orchestrator id and a cardId tells you that the user assigned that card to you.",
  "5. Ignore an event for a card that is not assigned to you.",
  "6. When no card is assigned to you, call wait_for_event and do nothing more.",
];

/**
 * Render the scope block of an orchestrator kickoff direction.
 *
 * @remarks
 * The block rides in the direction, not in the seeded playbook, because the seed does not
 * replace a playbook that is already installed.
 */
export function scopeBlock(kind: OrchestratorKind): string {
  if (kind === "board") {
    return "Scope: board. You are the board orchestrator. Triage the To Do column as section 2 of the rule book says.";
  }
  return [
    "Scope: feature. You are a feature orchestrator. Section 2 of the rule book does not apply to you. Use these rules in its place:",
    ...FEATURE_RULES,
  ].join("\n");
}
