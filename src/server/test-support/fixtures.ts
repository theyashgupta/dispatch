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
case "$1 $2" in
  "auth status")
    if [ -z "$CLAUDE_CONFIG_DIR" ]; then
      echo '{"loggedIn":true,"email":"home@example.com","orgId":"org-home","orgName":"Home Org","subscriptionType":"max"}'
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
          echo '{"loggedIn":true,"email":"second@example.com","orgId":"org-2","orgName":"Second Org","subscriptionType":"pro"}' > "$CLAUDE_CONFIG_DIR/.fake-login"
          echo "Logged in"
          exit 0
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
  };
  process.env.FAKE_KEYCHAIN_DIR = keychainDir;
  process.env.HOME = home;
  process.env.DISPATCH_DIR = dispatchDir;
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  const cleanup = (): void => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { root, home, dispatchDir, binDir, keychainDir, cleanup };
}
