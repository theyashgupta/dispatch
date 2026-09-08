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

/**
 * Quote argv tokens into one POSIX shell command line where every token survives as exactly one
 * literal argument, refusing any token that carries a control byte.
 *
 * @remarks Single quotes neutralise every shell PARSER metacharacter, but the line is typed
 * through the shell's line editor, which acts on control bytes (`\x15` erases the line,
 * `\x04` ends the shell, a TAB completes) before the parser ever sees the quotes; no quoting
 * survives that, so such tokens are rejected rather than mangled. Measured in sh, bash and zsh.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 */
export function shellQuote(tokens: string[]): string {
  if (tokens.some(hasControlByte)) {
    throw new Error("launch argument contains a control character");
  }
  return tokens.map((t) => `'${t.replace(/'/g, `'\\''`)}'`).join(" ");
}

/**
 * True when `text` holds a byte the shell's line editor interprets: a C0 control or DEL, except
 * newline, which an open quote carries onto a continuation prompt as ordinary text.
 */
export function hasControlByte(text: string): boolean {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code < 0x20 && ch !== "\n") || code === 0x7f) return true;
  }
  return false;
}
