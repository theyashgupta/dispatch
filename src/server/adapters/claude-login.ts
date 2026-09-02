import { spawnPiped } from "./exec.js";

export interface LoginExit {
  code: number | null;
  accessDenied: boolean;
}

export interface LoginProcess {
  submitCode(code: string): void;
  kill(): void;
  exited: Promise<LoginExit>;
}

export interface LoginHandlers {
  onUrl(url: string): void;
  onInvalidCode(): void;
}

const OUTPUT_CAP = 64 * 1024;
// eslint-disable-next-line no-control-regex -- the ESC bytes are the OSC 8 hyperlink delimiters being matched
const OSC8_RE = /\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Pull the sign-in url out of a chunk of login output, dropping the OSC 8 hyperlink escapes the
 * CLI wraps it in so the visible text is what gets matched.
 */
export function extractLoginUrl(text: string): string | null {
  const visible = text.replace(OSC8_RE, "");
  const m = /visit:\s*(https?:\/\/\S+)/.exec(visible);
  return m ? m[1] : null;
}

/**
 * Whether the CLI rejected a pasted code. It re-prompts instead of exiting, so the caller must end
 * the login itself.
 */
export function hasInvalidCode(text: string): boolean {
  return /Invalid code/.test(text);
}

/**
 * Whether the output carries the CLI's access-denied marker (the user cancelled on the sign-in
 * page).
 */
export function hasAccessDenied(text: string): boolean {
  return /access_denied/i.test(text);
}

/**
 * Spawn the Claude CLI login for one config dir with stdin piped for the pasted code. Stdout and
 * stderr are scanned for the url, the invalid-code line, and the access-denied marker; nothing is
 * logged and the captured output is capped so a chatty CLI cannot grow memory.
 * @remarks Uses the chokepoint's `spawnPiped` rather than `run`, which is run-to-completion and
 * has no stdin.
 */
export function spawnClaudeLogin(
  claudePath: string,
  configDir: string,
  handlers: LoginHandlers,
): LoginProcess {
  const child = spawnPiped(claudePath, ["auth", "login"], {
    env: { CLAUDE_CONFIG_DIR: configDir },
  });

  let buffer = "";
  let urlSent = false;
  let invalidSent = false;
  let accessDenied = false;

  const consume = (chunk: Buffer): void => {
    buffer = (buffer + chunk.toString("utf8")).slice(-OUTPUT_CAP);
    if (!urlSent) {
      const url = extractLoginUrl(buffer);
      if (url) {
        urlSent = true;
        handlers.onUrl(url);
      }
    }
    if (!invalidSent && hasInvalidCode(buffer)) {
      invalidSent = true;
      handlers.onInvalidCode();
    }
    if (hasAccessDenied(buffer)) accessDenied = true;
  };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);

  const exited = new Promise<LoginExit>((resolve) => {
    child.on("error", () => resolve({ code: null, accessDenied }));
    child.on("exit", (code) => resolve({ code, accessDenied }));
  });

  return {
    submitCode(code) {
      child.stdin?.write(code + "\n");
    },
    kill() {
      try {
        child.kill();
      } catch {}
    },
    exited,
  };
}
