export interface ClaudeLaunchInput {
  claudePath: string;
  claudeArgs: string[];
  leadingArgs?: string[];
  settingsPath: string;
  hooks: { port: number; token: string; cardId: string } | null;
  configDir?: string;
}

export interface ClaudeLaunch {
  argv: string[];
  env: Record<string, string>;
}

/**
 * The one place a Claude REPL's argv and env are assembled for tmux, shared by the start saga and
 * the resume path. The hooks branch adds the settings layer and the hook variables; an added
 * account adds `CLAUDE_CONFIG_DIR`; Default adds nothing, so the home login is untouched.
 * @remarks Pure so the truth table (hooks on and off, Default and added account, resume args) is
 * asserted without tmux, and so the two launch sites cannot drift apart on which branch carries
 * the account variable.
 * @see docs/ARCHITECTURE.md#claude-accounts
 */
export function buildClaudeLaunch(input: ClaudeLaunchInput): ClaudeLaunch {
  const argv = [input.claudePath, ...(input.leadingArgs ?? [])];
  if (input.hooks) {
    argv.push("--settings", input.settingsPath);
  }
  argv.push(...input.claudeArgs);

  const env: Record<string, string> = {};
  if (input.hooks) {
    env.DISPATCH_HOOK_PORT = String(input.hooks.port);
    env.DISPATCH_HOOK_TOKEN = input.hooks.token;
    env.DISPATCH_CARD_ID = input.hooks.cardId;
  }
  if (input.configDir) {
    env.CLAUDE_CONFIG_DIR = input.configDir;
  }
  return { argv, env };
}
