import { run } from "./exec.js";
import { resolveBinaryPath } from "./resolve-binary.js";

export interface ClaudeIdentity {
  loggedIn: boolean;
  email: string;
  orgId: string;
  orgName: string;
  subscriptionType: string;
}

const CLI_TIMEOUT_MS = 20_000;

/**
 * The absolute `claude` path on PATH, or the bare name when `which` finds nothing so the spawn
 * error names the binary.
 */
export async function claudeBinaryPath(): Promise<string> {
  return (await resolveBinaryPath("claude")) ?? "claude";
}

/**
 * Ask the Claude CLI who is signed in for a config dir (the home login when `configDir` is
 * omitted). Returns a logged-out identity on any failure so a missing CLI never breaks listing.
 */
export async function readClaudeIdentity(
  configDir?: string,
): Promise<ClaudeIdentity> {
  const loggedOut: ClaudeIdentity = {
    loggedIn: false,
    email: "",
    orgId: "",
    orgName: "",
    subscriptionType: "",
  };
  try {
    const { stdout } = await run(
      await claudeBinaryPath(),
      ["auth", "status", "--json"],
      {
        timeout: CLI_TIMEOUT_MS,
        ...(configDir ? { env: { CLAUDE_CONFIG_DIR: configDir } } : {}),
      },
    );
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const str = (key: string): string => {
      const value = parsed[key];
      return typeof value === "string" ? value : "";
    };
    return {
      loggedIn: parsed.loggedIn === true,
      email: str("email"),
      orgId: str("orgId"),
      orgName: str("orgName"),
      subscriptionType: str("subscriptionType"),
    };
  } catch {
    return loggedOut;
  }
}

/**
 * Sign a config dir out so Claude Code deletes its own keychain item. Best effort: a missing CLI
 * or an already signed-out dir must never block the caller.
 */
export async function logoutClaudeConfigDir(configDir: string): Promise<void> {
  await run(await claudeBinaryPath(), ["auth", "logout"], {
    timeout: CLI_TIMEOUT_MS,
    env: { CLAUDE_CONFIG_DIR: configDir },
  }).catch(() => undefined);
}
