import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface IsolatedEnv {
  root: string;
  home: string;
  dispatchDir: string;
  binDir: string;
  keychainDir: string;
  cleanup: () => void;
}

const FAKE_CLAUDE = `#!/bin/sh
HOME_IDENTITY='{"loggedIn":true,"email":"home@example.com","orgId":"org-home","orgName":"Home Org","subscriptionType":"max"}'
case "$1 $2" in
  "auth status")
    if [ -z "$CLAUDE_CONFIG_DIR" ] && [ -f "$FAKE_CLAUDE_IDENTITY_FILE" ]; then
      cat "$FAKE_CLAUDE_IDENTITY_FILE"
    elif [ -z "$CLAUDE_CONFIG_DIR" ]; then
      echo "$HOME_IDENTITY"
    elif [ -f "$CLAUDE_CONFIG_DIR/.fake-login" ]; then
      cat "$CLAUDE_CONFIG_DIR/.fake-login"
    else
      echo '{"loggedIn":false,"authMethod":"none"}'
    fi
    ;;
  "auth logout")
    rm -f "$CLAUDE_CONFIG_DIR/.fake-login"
    echo "Logged out"
    ;;
  "auth login")
    echo "Opening browser to sign in…"
    printf 'If the browser didn%st open, visit: \\033]8;;https://claude.com/cai/oauth/authorize?code=abc&state=xyz\\007https://claude.com/cai/oauth/authorize?code=abc&state=xyz\\033]8;;\\007\\n' "'"
    printf 'Paste code here if prompted > '
    while :; do
      if ! read -r code; then
        sleep 30
        exit 1
      fi
      case "$code" in
        good)
          if [ -f "$FAKE_CLAUDE_LOGIN_IDENTITY_FILE" ]; then
            cp "$FAKE_CLAUDE_LOGIN_IDENTITY_FILE" "$CLAUDE_CONFIG_DIR/.fake-login"
          else
            echo '{"loggedIn":true,"email":"second@example.com","orgId":"org-2","orgName":"Second Org","subscriptionType":"pro"}' > "$CLAUDE_CONFIG_DIR/.fake-login"
          fi
          echo "Logged in"
          exit 0
          ;;
        home)
          if [ -f "$FAKE_CLAUDE_IDENTITY_FILE" ]; then
            cp "$FAKE_CLAUDE_IDENTITY_FILE" "$CLAUDE_CONFIG_DIR/.fake-login"
          else
            echo "$HOME_IDENTITY" > "$CLAUDE_CONFIG_DIR/.fake-login"
          fi
          echo "Logged in"
          exit 0
          ;;
        stale)
          echo "Login failed: Request failed with status code 400" >&2
          exit 1
          ;;
        crash)
          exit 1
          ;;
        hang)
          sleep 30
          exit 1
          ;;
        deny)
          echo "OAuth error: error=access_denied&error_description=user+cancelled"
          exit 1
          ;;
        noid)
          echo "Logged in"
          exit 0
          ;;
        *)
          echo "Invalid code. Please make sure the full code was copied."
          printf 'Paste code here if prompted > '
          ;;
      esac
    done
    ;;
  *)
    echo "fake claude: unsupported $1 $2" >&2
    exit 1
    ;;
esac
`;

const FAKE_SECURITY = `#!/bin/sh
service=""
account=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -s) service="$2"; shift 2 ;;
    -a) account="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$service" in
  "Claude Code-credentials-"*)
    if [ -f "$FAKE_KEYCHAIN_DIR/$service" ]; then
      cat "$FAKE_KEYCHAIN_DIR/$service"
      exit 0
    fi
    ;;
esac
if [ "$service" = "Claude Code-credentials" ]; then
  if [ -n "$account" ]; then
    if [ -n "$FAKE_SECURITY_DENY_ACCOUNT" ]; then
      echo "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." >&2
      exit 44
    fi
    echo '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-FAKE-HOME-ACCT","refreshToken":"sk-ant-ort01-FAKE"}}'
    exit 0
  fi
  echo '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-FAKE-HOME","refreshToken":"sk-ant-ort01-FAKE"}}'
  exit 0
fi
echo "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." >&2
exit 44
`;

/**
 * Point every path constant at a throwaway tree and put a fake `claude` first on PATH. Must run
 * before the module under test is imported, since `paths.ts` reads the environment once.
 * The provider API overrides a QA shell exports are cleared, so fetch mocks keyed on the real
 * provider hosts still match.
 */
export function isolateEnv(): IsolatedEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-test-"));
  const home = path.join(root, "home");
  const dispatchDir = path.join(root, "dispatch");
  const binDir = path.join(root, "bin");
  const keychainDir = path.join(root, "keychain");
  fs.mkdirSync(keychainDir, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "skills"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "statsig"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}\n");
  fs.writeFileSync(path.join(home, ".claude", "history.jsonl"), "");
  fs.writeFileSync(
    path.join(home, ".claude", ".credentials.json"),
    '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-FAKE-HOME-FILE"}}\n',
  );
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: "dark",
      oauthAccount: { emailAddress: "home@example.com" },
    }),
  );
  fs.mkdirSync(dispatchDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(dispatchDir, "config.json"),
    JSON.stringify({ linearApiKey: "", port: 4700 }, null, 2) + "\n",
    { mode: 0o600 },
  );
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "claude"), FAKE_CLAUDE, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, "security"), FAKE_SECURITY, {
    mode: 0o755,
  });
  const previous = {
    HOME: process.env.HOME,
    DISPATCH_DIR: process.env.DISPATCH_DIR,
    PATH: process.env.PATH,
    FAKE_KEYCHAIN_DIR: process.env.FAKE_KEYCHAIN_DIR,
    DISPATCH_GITHUB_API_URL: process.env.DISPATCH_GITHUB_API_URL,
    DISPATCH_SLACK_API_URL: process.env.DISPATCH_SLACK_API_URL,
  };
  process.env.FAKE_KEYCHAIN_DIR = keychainDir;
  process.env.HOME = home;
  process.env.DISPATCH_DIR = dispatchDir;
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  delete process.env.DISPATCH_GITHUB_API_URL;
  delete process.env.DISPATCH_SLACK_API_URL;
  const cleanup = (): void => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  };
  return { root, home, dispatchDir, binDir, keychainDir, cleanup };
}

export interface TmuxEnv extends IsolatedEnv {
  canRunRealTmux: boolean;
  killServer(): Promise<void>;
}

/**
 * An isolated env whose tmux calls hit a private server: `TMUX_TMPDIR` under the sandbox root,
 * `SHELL=/bin/zsh`, no inherited `TMUX`, and a `-L` label derived from the isolated DISPATCH_DIR.
 *
 * @remarks Call before the first dynamic import of `adapters/tmux.js`, which computes its `-L`
 * label from `DISPATCH_DIR` at import time; the adapter is imported lazily here for that reason.
 * Empty zsh rc files are written into the isolated HOME so a zsh with no rc never opens its
 * first-run wizard (a builtin `read` that would swallow the typed launch line on Linux CI).
 */
export async function isolateTmuxEnv(): Promise<TmuxEnv> {
  const env = isolateEnv();
  process.env.TMUX_TMPDIR = env.root;
  process.env.SHELL = "/bin/zsh";
  delete process.env.TMUX;
  for (const rc of [".zshenv", ".zshrc"]) {
    fs.writeFileSync(path.join(env.home, rc), "");
  }
  const { resolveBinaryPath } = await import("../adapters/resolve-binary.js");
  const canRunRealTmux =
    (await resolveBinaryPath("tmux")) !== null && fs.existsSync("/bin/zsh");
  if (!canRunRealTmux && process.env.CI) {
    throw new Error(
      "CI must provide tmux and /bin/zsh: the shell-session tests may not skip there",
    );
  }
  return {
    ...env,
    canRunRealTmux,
    async killServer() {
      const tmux = await import("../adapters/tmux.js");
      const { run } = await import("../adapters/exec.js");
      await run("tmux", [...tmux.TMUX_SERVER_ARGS, "kill-server"]).catch(
        () => undefined,
      );
    },
  };
}

/**
 * Build the REPL body of {@link writeFakeRepl} in state folder mode, with `stateDir` baked in.
 *
 * @remarks The files in `stateDir` drive it, so a QA script changes its state with no access to
 * the pane environment. Keys are read one at a time, so Escape and the arrow keys reach the limit
 * surfaces the way they reach the real CLI.
 */
function stateDirRepl(stateDir: string, refuseContinue: string): string {
  const state = `'${stateDir.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/bash
state=${state}
if [ "$1" = "auth" ]; then
  FAKE_CLAUDE_IDENTITY_FILE="$state/identity.json" FAKE_CLAUDE_LOGIN_IDENTITY_FILE="$state/login-identity.json" exec "$(dirname "$0")/claude-auth" "$@"
fi
if [ "$1" = "--version" ]; then
  echo "2.1.289 (Claude Code)"
  exit 0
fi
printf 'CLAUDE_CONFIG_DIR=%s\\t%s\\n' "\${CLAUDE_CONFIG_DIR:-}" "$*" >> "$state/launches.log"
if [ -n "$FAKE_CLAUDE_ARGV_FILE" ]; then printf '%s\\n' "$@" > "$FAKE_CLAUDE_ARGV_FILE"; fi
case " $* " in
  *" --resume missing-"*) echo "No conversation found with session ID: $2"; exit 1 ;;
${refuseContinue}esac
trap 'exit 0' INT
menu() {
  case "$1" in
    b) options=("Stop and wait for limit to reset" "Wait here, then continue automatically at 10:40am" "Switch to usage credits" "Upgrade your plan") ;;
    b-credits-first) options=("Switch to usage credits" "Upgrade your plan" "Stop and wait for limit to reset" "Wait here, then continue automatically at 10:40am") ;;
    *) options=("Switch to usage credits" "Upgrade your plan") ;;
  esac
}
render() {
  printf '\\033[2J\\033[H'
  case "$shown" in
    busy) echo "* Working... (esc to interrupt)" ;;
    limit-a) echo "Usage limit reached · continuing automatically at 10:40am · esc to cancel" ;;
    limit-b*)
      echo "What do you want to do?"
      echo
      for i in "\${!options[@]}"; do
        if [ "$i" -eq "$cursor" ]; then mark="❯"; else mark=" "; fi
        echo " $mark $((i + 1)). \${options[$i]}"
      done
      ;;
    *) echo "? for shortcuts" ;;
  esac
}
key() {
  printf '%s\\n' "$1" >> "$state/keys.log"
}
shown=""
line=""
cursor=0
while :; do
  if [ -f "$state/limit-mode" ]; then now="limit-$(head -n 1 "$state/limit-mode")"
  elif [ -f "$state/busy" ]; then now=busy
  else now=idle; fi
  if [ "$now" != "$shown" ]; then
    shown=$now
    cursor=0
    menu "\${shown#limit-}"
    render
  fi
  IFS= read -r -s -n 1 -d '' -t 1 ch
  rc=$?
  if [ "$rc" -gt 128 ]; then continue; fi
  if [ "$rc" -ne 0 ]; then sleep 1; continue; fi
  case "$ch" in
    $'\\e')
      IFS= read -r -s -n 2 -t 1 rest
      case "$rest" in
        '[A') key "<Up>"; [ "$cursor" -gt 0 ] && cursor=$((cursor - 1)); render ;;
        '[B') key "<Down>"; [ "$cursor" -lt $((\${#options[@]} - 1)) ] && cursor=$((cursor + 1)); render ;;
        *)
          key "<Esc>"
          case "$shown" in limit-*) rm -f "$state/limit-mode" ;; esac
          ;;
      esac
      ;;
    $'\\r'|$'\\n')
      if [ -n "$line" ]; then key "$line"; else key "<Enter>"; fi
      case "$shown" in
        limit-b*)
          key "selected: \${options[$cursor]}"
          rm -f "$state/limit-mode"
          ;;
      esac
      [ "$line" = "/exit" ] && exit 0
      line=""
      ;;
    *) line="$line$ch" ;;
  esac
done
`;
}

/**
 * Install a fake `claude` REPL on the isolated PATH.
 *
 * @remarks It records its argv to `argvFile`, prints the READY footer, exits on SIGINT like the
 * real one, and refuses a `--resume missing-*` id with Claude's own "No conversation found"
 * message. With `stateDir` it also answers `auth` from the auth fake (the home identity from
 * `identity.json`), logs each launch to `launches.log` and each key to `keys.log`, exits on
 * `/exit`, and shows `esc to interrupt` while `busy` exists or the limit surface that
 * `limit-mode` names (`a`, `b`, `b-credits-first`, `b-nostop`).
 */
export function writeFakeRepl(
  env: Pick<IsolatedEnv, "binDir">,
  argvFile: string,
  opts: { refuseContinue?: boolean; stateDir?: string } = {},
): void {
  process.env.FAKE_CLAUDE_ARGV_FILE = argvFile;
  const refuseContinue = opts.refuseContinue
    ? `  *" --continue "*) echo "No conversation found to continue"; exit 1 ;;\n`
    : "";
  if (opts.stateDir !== undefined) {
    fs.mkdirSync(opts.stateDir, { recursive: true });
    fs.writeFileSync(path.join(env.binDir, "claude-auth"), FAKE_CLAUDE, {
      mode: 0o755,
    });
    fs.writeFileSync(
      path.join(env.binDir, "claude"),
      stateDirRepl(opts.stateDir, refuseContinue),
      { mode: 0o755 },
    );
    return;
  }
  fs.writeFileSync(
    path.join(env.binDir, "claude"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_CLAUDE_ARGV_FILE"
case " $* " in
  *" --resume missing-"*) echo "No conversation found with session ID: $2"; exit 1 ;;
${refuseContinue}esac
echo "? for shortcuts"
trap 'exit 0' INT
while :; do sleep 1; done
`,
    { mode: 0o755 },
  );
}

/** The argv the fake REPL recorded, or null when it has not run since the file was removed. */
export function readArgv(file: string): string[] | null {
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim().split("\n")
    : null;
}

/** Poll `probe` every 100ms until it is true, throwing with `label` at the deadline. */
export async function waitFor(
  probe: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (await probe()) return;
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`);
}
